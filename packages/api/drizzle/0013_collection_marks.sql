-- What's new: one timestamp per person per collection, "when I last opened it".
--
-- This is not read/unread on posts (docs/DECISIONS.md, "river, no read state").
-- A count of posts newer than the mark is what the sidebar shows to people who
-- turn the option on, and the mark is only written from a device where it is
-- on. A collection with no row counts from its own creation. Feeds added later
-- are treated as if they had always been there; nothing is kept per feed or per
-- post, so the table holds users × collections rows and no more.
--
-- Code on the previous revision never reads the table, so rolling back needs
-- nothing.

create table if not exists collection_marks (
  user_id bigint not null references users(id) on delete cascade,
  collection_id bigint not null references collections(id) on delete cascade,
  seen_at timestamptz not null,
  primary key (user_id, collection_id)
);
