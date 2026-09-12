CREATE TYPE "public"."feed_kind" AS ENUM('rss', 'atom', 'json', 'rdf', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."profile_visibility" AS ENUM('public', 'private');--> statement-breakpoint
CREATE TABLE "blocks" (
	"user_id" bigint NOT NULL,
	"feed_id" bigint NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blocks_user_id_feed_id_pk" PRIMARY KEY("user_id","feed_id")
);
--> statement-breakpoint
CREATE TABLE "bookmarks" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"item_id" bigint,
	"feed_id" bigint,
	"url" text NOT NULL,
	"title" text,
	"summary" text,
	"image_url" text,
	"site_title" text,
	"author" text,
	"published_at" timestamp with time zone,
	"note" text,
	"is_public" boolean DEFAULT false NOT NULL,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collection_feeds" (
	"collection_id" bigint NOT NULL,
	"feed_id" bigint NOT NULL,
	"title_override" text,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collection_feeds_collection_id_feed_id_pk" PRIMARY KEY("collection_id","feed_id")
);
--> statement-breakpoint
CREATE TABLE "collections" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"parent_id" bigint,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"is_public" boolean DEFAULT true NOT NULL,
	"copied_from_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint,
	"kind" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feed_icons" (
	"feed_id" bigint PRIMARY KEY NOT NULL,
	"source_url" text NOT NULL,
	"content_type" text NOT NULL,
	"width" integer,
	"bytes" "bytea" NOT NULL,
	"hash" text NOT NULL,
	"generic" boolean DEFAULT false NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feeds" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"site_url" text,
	"title" text,
	"description" text,
	"kind" "feed_kind" DEFAULT 'unknown' NOT NULL,
	"etag" text,
	"last_modified" text,
	"last_fetched_at" timestamp with time zone,
	"next_fetch_at" timestamp with time zone DEFAULT now() NOT NULL,
	"fetch_interval_s" integer DEFAULT 3600 NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"last_status" integer,
	"last_error" text,
	"last_item_at" timestamp with time zone,
	"icon_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fetch_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"feed_id" bigint NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" integer,
	"duration_ms" integer,
	"items_new" integer,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "instance_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"code" text PRIMARY KEY NOT NULL,
	"created_by" bigint NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"used_by" bigint,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"feed_id" bigint NOT NULL,
	"dedupe_key" text NOT NULL,
	"url" text,
	"title" text,
	"author" text,
	"summary" text,
	"content" text,
	"image_url" text,
	"published_at" timestamp with time zone NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"handle" text NOT NULL,
	"password_hash" text,
	"display_name" text,
	"bio" text,
	"homepage_url" text,
	"profile_visibility" "profile_visibility" DEFAULT 'public' NOT NULL,
	"show_collections" boolean DEFAULT true NOT NULL,
	"show_bookmarks" boolean DEFAULT true NOT NULL,
	"claimed_feed_id" bigint,
	"claim_verified_at" timestamp with time zone,
	"track_activity" boolean,
	"is_admin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_handle_unique" UNIQUE("handle")
);
--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_feed_id_feeds_id_fk" FOREIGN KEY ("feed_id") REFERENCES "public"."feeds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_feed_id_feeds_id_fk" FOREIGN KEY ("feed_id") REFERENCES "public"."feeds"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_feeds" ADD CONSTRAINT "collection_feeds_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_feeds" ADD CONSTRAINT "collection_feeds_feed_id_feeds_id_fk" FOREIGN KEY ("feed_id") REFERENCES "public"."feeds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_icons" ADD CONSTRAINT "feed_icons_feed_id_feeds_id_fk" FOREIGN KEY ("feed_id") REFERENCES "public"."feeds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fetch_log" ADD CONSTRAINT "fetch_log_feed_id_feeds_id_fk" FOREIGN KEY ("feed_id") REFERENCES "public"."feeds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_used_by_users_id_fk" FOREIGN KEY ("used_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_feed_id_feeds_id_fk" FOREIGN KEY ("feed_id") REFERENCES "public"."feeds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bookmarks_user_url_uq" ON "bookmarks" USING btree ("user_id","url");--> statement-breakpoint
CREATE INDEX "bookmarks_user_saved_idx" ON "bookmarks" USING btree ("user_id","saved_at");--> statement-breakpoint
CREATE INDEX "collection_feeds_feed_idx" ON "collection_feeds" USING btree ("feed_id");--> statement-breakpoint
CREATE UNIQUE INDEX "collections_user_parent_slug_uq" ON "collections" USING btree ("user_id","parent_id","slug");--> statement-breakpoint
CREATE INDEX "collections_user_idx" ON "collections" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "events_created_idx" ON "events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "feed_icons_hash_idx" ON "feed_icons" USING btree ("hash");--> statement-breakpoint
CREATE UNIQUE INDEX "feeds_url_uq" ON "feeds" USING btree ("url");--> statement-breakpoint
CREATE INDEX "feeds_next_fetch_idx" ON "feeds" USING btree ("next_fetch_at");--> statement-breakpoint
CREATE INDEX "fetch_log_feed_at_idx" ON "fetch_log" USING btree ("feed_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "items_feed_dedupe_uq" ON "items" USING btree ("feed_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "items_published_idx" ON "items" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "items_feed_published_idx" ON "items" USING btree ("feed_id","published_at");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");