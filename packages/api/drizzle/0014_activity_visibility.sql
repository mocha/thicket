-- Recent activity gets its own audience. Until now it had no switch of its own:
-- the one list simply inherited whatever the Collections, Bookmarks and Notes
-- sections each allowed. This adds a cap over the whole list, so someone can
-- share those sections yet keep the running "what I've been up to" feed to a
-- narrower audience, or to themselves. It never widens a section: an entry
-- still has to clear its own section's audience to appear at all.
--
-- Default 'public' matches today's behaviour, where activity was already as
-- open as the sections feeding it.
alter table users
  add column activity_visibility share_level not null default 'public';
