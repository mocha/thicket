-- The river now merges each followed feed's newest page instead of walking the
-- global published_at index and discarding other people's feeds (routes/river.ts).
-- This index carries id so the per-feed scan never touches the heap, and its
-- order matches the query's (published_at desc, id desc).
--
-- Plain CREATE INDEX: at alpha size (14.5k rows) it is instant. On a large
-- instance, create it CONCURRENTLY by hand before upgrading and this becomes a
-- no-op.
create index if not exists items_feed_published_id_idx on items (feed_id, published_at desc, id desc);
--> statement-breakpoint

-- Superseded: every lookup it served is a prefix of the new one.
drop index if exists items_feed_published_idx;
