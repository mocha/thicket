-- A collection's own visibility becomes the three-way scale the account already
-- uses (share_level, migration 0006): private, the people I follow, or anyone.
-- It still only narrows the account's collections_visibility, never widens it:
-- a public collection inside a friends-only account is still friends-only.
--
-- The boolean was exactly the two ends of the new scale, so nothing changes
-- audience on upgrade.
alter table collections add column visibility share_level not null default 'public';
--> statement-breakpoint
update collections set visibility = (case when is_public then 'public' else 'private' end)::share_level;
--> statement-breakpoint
alter table collections drop column is_public;
