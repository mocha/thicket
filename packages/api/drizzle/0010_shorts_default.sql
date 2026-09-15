-- A person's default for YouTube Shorts, and per-feed settings that follow it.
--
-- feed_settings.hide_shorts becomes three-way: true (hide on this channel),
-- false (show on this channel whatever my default), or null (do what my
-- default says). Every existing false was the only default there was rather
-- than a choice, so it becomes null, and a row left holding nothing is removed,
-- which keeps "a row means someone changed something" true.
--
-- Code on the previous revision reads a null the same as false, which is what
-- those rows meant to it, so rolling the application back needs no schema
-- change.

alter table users add column if not exists hide_shorts_by_default boolean not null default false;
--> statement-breakpoint
alter table feed_settings alter column hide_shorts drop not null;
--> statement-breakpoint
alter table feed_settings alter column hide_shorts drop default;
--> statement-breakpoint
update feed_settings set hide_shorts = null where hide_shorts = false;
--> statement-breakpoint
delete from feed_settings where display_name is null and hide_shorts is null;
