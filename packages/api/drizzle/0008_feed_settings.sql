-- Per-person settings on a feed: a reader's own name for it, and for YouTube,
-- whether its Shorts reach their rivers. The table is ADDITIVE.
--
-- The rest folds in the "No Shorts" feed variant (2026-09-13..14), which this
-- setting replaces. A No Shorts feed was stored at a channel's Videos tab
-- address (youtube.com/playlist?list=UULF…) but fetched the channel's own feed,
-- so under "a feed is the address fetched" it was never a separate feed. Each
-- one becomes the channel feed, filed in the same collections, with Shorts
-- hidden for everyone who had it. Posts, notes and bookmarks move with it.
-- On an instance that never had one, every statement after the index is a
-- no-op.

create table if not exists feed_settings (
  user_id bigint not null references users(id) on delete cascade,
  feed_id bigint not null references feeds(id) on delete cascade,
  display_name text,
  hide_shorts boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, feed_id)
);
--> statement-breakpoint
create index if not exists feed_settings_feed_idx on feed_settings (feed_id);
--> statement-breakpoint
create temporary table no_shorts_fold on commit drop as
  select f.id as old_id,
         'https://www.youtube.com/feeds/videos.xml?channel_id=UC' || substring(f.url from 'list=UULF([A-Za-z0-9_-]{22})') as channel_url,
         nullif(regexp_replace(coalesce(f.title, ''), ' \(no Shorts\)$', ''), '') as title,
         f.site_url, f.description, null::bigint as new_id
  from feeds f
  where f.url ~ '^https://www\.youtube\.com/playlist\?list=UULF[A-Za-z0-9_-]{22}$';
--> statement-breakpoint
insert into feeds (url, site_url, title, description, kind)
  select channel_url, site_url, title, description, 'atom' from no_shorts_fold
  on conflict (url) do nothing;
--> statement-breakpoint
update no_shorts_fold n set new_id = f.id from feeds f where f.url = n.channel_url;
--> statement-breakpoint
insert into collection_feeds (collection_id, feed_id, added_at)
  select cf.collection_id, n.new_id, cf.added_at
  from collection_feeds cf join no_shorts_fold n on n.old_id = cf.feed_id
  on conflict do nothing;
--> statement-breakpoint
insert into feed_settings (user_id, feed_id, hide_shorts)
  select distinct col.user_id, n.new_id, true
  from collection_feeds cf join collections col on col.id = cf.collection_id join no_shorts_fold n on n.old_id = cf.feed_id
  on conflict (user_id, feed_id) do update set hide_shorts = true, updated_at = now();
--> statement-breakpoint
-- Posts the channel feed does not already hold move across as they are.
update items i set feed_id = n.new_id
  from no_shorts_fold n
  where i.feed_id = n.old_id
    and not exists (select 1 from items j where j.feed_id = n.new_id and j.dedupe_key = i.dedupe_key);
--> statement-breakpoint
-- Posts it does hold: point notes and bookmarks at the channel feed's copy
-- before the duplicate goes. A note is one per person per post, so a person
-- who somehow noted both copies keeps the one already on the channel feed.
update notes nt set item_id = j.id
  from items i
  join no_shorts_fold n on n.old_id = i.feed_id
  join items j on j.feed_id = n.new_id and j.dedupe_key = i.dedupe_key
  where nt.item_id = i.id
    and not exists (select 1 from notes x where x.user_id = nt.user_id and x.item_id = j.id);
--> statement-breakpoint
update bookmarks b set item_id = j.id, feed_id = n.new_id
  from items i
  join no_shorts_fold n on n.old_id = i.feed_id
  join items j on j.feed_id = n.new_id and j.dedupe_key = i.dedupe_key
  where b.item_id = i.id;
--> statement-breakpoint
update bookmarks b set feed_id = n.new_id from no_shorts_fold n where b.feed_id = n.old_id;
--> statement-breakpoint
delete from feeds f using no_shorts_fold n where f.id = n.old_id;
