CREATE TABLE "copy_ignored_feeds" (
	"collection_id" bigint NOT NULL,
	"feed_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "copy_ignored_feeds_collection_id_feed_id_pk" PRIMARY KEY("collection_id","feed_id")
);
--> statement-breakpoint
ALTER TABLE "collections" ADD COLUMN "follows_original" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "copy_ignored_feeds" ADD CONSTRAINT "copy_ignored_feeds_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copy_ignored_feeds" ADD CONSTRAINT "copy_ignored_feeds_feed_id_feeds_id_fk" FOREIGN KEY ("feed_id") REFERENCES "public"."feeds"("id") ON DELETE cascade ON UPDATE no action;