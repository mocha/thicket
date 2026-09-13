-- Notes, bookmarks and collections each get three audiences instead of two:
-- nobody, the people I follow, or anyone. "Friends" means the people I follow,
-- which is what the word already means everywhere else in thicket — following
-- someone is how you choose to share with them, and someone following me does
-- not thereby gain access to anything.
create type share_level as enum ('private', 'friends', 'public');
--> statement-breakpoint
alter table users
  add column notes_visibility share_level not null default 'public',
  add column bookmarks_visibility share_level not null default 'public',
  add column collections_visibility share_level not null default 'public';
--> statement-breakpoint
-- The old booleans were exactly the two ends of the new scale.
update users set
  notes_visibility = (case when show_notes then 'public' else 'private' end)::share_level,
  bookmarks_visibility = (case when show_bookmarks then 'public' else 'private' end)::share_level,
  collections_visibility = (case when show_collections then 'public' else 'private' end)::share_level;
--> statement-breakpoint
alter table users drop column show_notes, drop column show_bookmarks, drop column show_collections;
