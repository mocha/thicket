ALTER TABLE "users" ADD COLUMN "notify_follows" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "notify_bookmarks" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "notify_notes" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "notify_collections" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "notify_invites" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "notify_replies" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "mentions_from" "notes_from" DEFAULT 'everyone' NOT NULL;--> statement-breakpoint
CREATE INDEX "bookmarks_noted_created_idx" ON "bookmarks" USING btree ("note_created_at") WHERE "bookmarks"."note" is not null;--> statement-breakpoint
CREATE INDEX "collections_user_created_idx" ON "collections" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "invites_created_by_used_idx" ON "invites" USING btree ("created_by","used_at");