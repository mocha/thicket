-- Counts the lists sort by, kept on the row instead of counted per page view.
--
-- Measured on production 2026-10-11: search counted every matched feed's whole
-- history twice per query, and "Most active" counted every feed's last 30 days
-- before it could sort. Both grow with every post stored. Reading a column
-- instead keeps them flat.
--
-- How each stays right:
--  - follower_count, item_count, collections.feed_count: recounted by the
--    triggers below for just the feeds or collections a statement touched.
--    A recount, never a +1/-1, so a missed or doubled event can't leave a
--    permanent error.
--
--    Concurrent writers: each recount first locks the rows it is about to
--    count, then counts in a statement of its own. A statement's snapshot is
--    taken when it starts, so a writer that had to wait for the lock counts
--    after the other has committed, and sees its rows. Without that, adding
--    feed B and removing feed A in two overlapping transactions left a
--    collection holding B stored as empty (PR #267 review). FOR NO KEY UPDATE
--    leaves alone the key-share lock that inserting a collection_feeds row
--    takes on its collection; rows are locked in id order so two recounts
--    can't each hold what the other wants. The nightly reconcile in
--    lib/counts.ts still rechecks everything and logs any drift.
--  - posts_30d, posts_90d: change as time passes with no write to hang a
--    trigger on, so lib/counts.ts recounts them hourly.
--
-- Statement-level triggers with transition tables, so a 5,000-row retention
-- delete or a feed merge recounts each affected feed once, not once per row.
-- Postgres allows a transition table only on single-event triggers, hence one
-- trigger per event.
--
-- ADDITIVE: new columns and triggers that code on the previous revision never
-- reads; its writes keep the counts right through the triggers.

ALTER TABLE "collections" ADD COLUMN "feed_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "feeds" ADD COLUMN "follower_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "feeds" ADD COLUMN "item_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "feeds" ADD COLUMN "posts_30d" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "feeds" ADD COLUMN "posts_90d" integer DEFAULT 0 NOT NULL;--> statement-breakpoint

-- Recount followers for these feeds and feed counts for these collections.
-- Lock first, count after (see the top of this file). Only rows whose number
-- changed are written, so a no-op costs no dead tuple.
create or replace function thicket_recount_follows(feed_ids bigint[], collection_ids bigint[]) returns void language plpgsql as $$
begin
  perform 1 from feeds where id = any(feed_ids) order by id for no key update;
  perform 1 from collections where id = any(collection_ids) order by id for no key update;
  update feeds f set follower_count = n.c
  from (select f2.id, (select count(distinct col.user_id)::int from collection_feeds cf
                        join collections col on col.id = cf.collection_id where cf.feed_id = f2.id) as c
        from feeds f2 where f2.id = any(feed_ids)) n
  where f.id = n.id and f.follower_count <> n.c;
  update collections col set feed_count = n.c
  from (select c2.id, (select count(*)::int from collection_feeds cf where cf.collection_id = c2.id) as c
        from collections c2 where c2.id = any(collection_ids)) n
  where col.id = n.id and col.feed_count <> n.c;
end $$;--> statement-breakpoint

create or replace function thicket_collection_feeds_ins() returns trigger language plpgsql as $$
begin
  perform thicket_recount_follows(array(select distinct feed_id from new_rows), array(select distinct collection_id from new_rows));
  return null;
end $$;--> statement-breakpoint
create or replace function thicket_collection_feeds_del() returns trigger language plpgsql as $$
begin
  perform thicket_recount_follows(array(select distinct feed_id from old_rows), array(select distinct collection_id from old_rows));
  return null;
end $$;--> statement-breakpoint
create or replace function thicket_collection_feeds_upd() returns trigger language plpgsql as $$
begin
  perform thicket_recount_follows(
    array(select feed_id from old_rows union select feed_id from new_rows),
    array(select collection_id from old_rows union select collection_id from new_rows));
  return null;
end $$;--> statement-breakpoint

create trigger collection_feeds_counts_ins after insert on collection_feeds
  referencing new table as new_rows for each statement execute function thicket_collection_feeds_ins();--> statement-breakpoint
create trigger collection_feeds_counts_del after delete on collection_feeds
  referencing old table as old_rows for each statement execute function thicket_collection_feeds_del();--> statement-breakpoint
create trigger collection_feeds_counts_upd after update on collection_feeds
  referencing old table as old_rows new table as new_rows for each statement execute function thicket_collection_feeds_upd();--> statement-breakpoint

-- Recount stored posts for these feeds. Lock first, count after, as above.
create or replace function thicket_recount_items(feed_ids bigint[]) returns void language plpgsql as $$
begin
  perform 1 from feeds where id = any(feed_ids) order by id for no key update;
  update feeds f set item_count = n.c
  from (select f2.id, (select count(*)::int from items i where i.feed_id = f2.id) as c
        from feeds f2 where f2.id = any(feed_ids)) n
  where f.id = n.id and f.item_count <> n.c;
end $$;--> statement-breakpoint

create or replace function thicket_items_ins() returns trigger language plpgsql as $$
begin
  perform thicket_recount_items(array(select distinct feed_id from new_rows));
  return null;
end $$;--> statement-breakpoint
create or replace function thicket_items_del() returns trigger language plpgsql as $$
begin
  perform thicket_recount_items(array(select distinct feed_id from old_rows));
  return null;
end $$;--> statement-breakpoint
-- Only rows whose feed changed: storeItems' upsert fires update triggers too
-- (it fills in a missing body), and those touch no count.
create or replace function thicket_items_upd() returns trigger language plpgsql as $$
begin
  perform thicket_recount_items(array(
    select unnest(array[o.feed_id, n.feed_id]) from old_rows o join new_rows n on n.id = o.id where n.feed_id <> o.feed_id));
  return null;
end $$;--> statement-breakpoint

create trigger items_counts_ins after insert on items
  referencing new table as new_rows for each statement execute function thicket_items_ins();--> statement-breakpoint
create trigger items_counts_del after delete on items
  referencing old table as old_rows for each statement execute function thicket_items_del();--> statement-breakpoint
-- Only a feed merge moves a post between feeds (feeds/merge.ts). Postgres
-- allows no column list on a trigger with transition tables, so the function
-- above picks out the moved rows itself.
create trigger items_counts_upd after update on items
  referencing old table as old_rows new table as new_rows for each statement execute function thicket_items_upd();--> statement-breakpoint

-- Fill everything once. On production (8,439 feeds, 531k posts) this is one
-- pass over the (feed, date) index.
update feeds f set
  follower_count = coalesce(fl.c, 0),
  item_count = coalesce(it.total, 0),
  posts_30d = coalesce(it.d30, 0),
  posts_90d = coalesce(it.d90, 0)
from feeds f2
left join (select cf.feed_id, count(distinct col.user_id)::int c from collection_feeds cf
           join collections col on col.id = cf.collection_id group by cf.feed_id) fl on fl.feed_id = f2.id
left join (select feed_id, count(*)::int total,
                  count(*) filter (where published_at > now() - interval '30 days')::int d30,
                  count(*) filter (where published_at > now() - interval '90 days')::int d90
           from items group by feed_id) it on it.feed_id = f2.id
where f.id = f2.id;--> statement-breakpoint
update collections col set feed_count = n.c
from (select collection_id, count(*)::int c from collection_feeds group by collection_id) n
where col.id = n.collection_id;
