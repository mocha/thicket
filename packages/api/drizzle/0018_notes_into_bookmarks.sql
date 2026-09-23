-- Notes move into bookmarks (issue #84): a note is part of a saved post, so it
-- lives on the bookmark and survives anything the bookmark survives.
ALTER TABLE "bookmarks" ADD COLUMN "note_created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookmarks" ADD COLUMN "note_updated_at" timestamp with time zone;--> statement-breakpoint
-- Every noted post gets a bookmark if it has none, snapshot taken from the post
-- as it is now. A post with no link of its own is saved under its page here.
-- saved_at is when the note was first written, so the list keeps its order.
INSERT INTO "bookmarks" ("user_id", "item_id", "feed_id", "url", "title", "summary", "image_url", "site_title", "author", "published_at", "saved_at")
SELECT DISTINCT ON (n.user_id, x.url)
       n.user_id, i.id, i.feed_id, x.url, i.title, i.summary, i.image_url, f.title, i.author, i.published_at, n.created_at
FROM "notes" n
JOIN "items" i ON i.id = n.item_id
JOIN "feeds" f ON f.id = i.feed_id
CROSS JOIN LATERAL (SELECT coalesce(i.url, '/feeds/' || f.id || '/' || coalesce(
    nullif(left(trim(both '-' from regexp_replace(lower(f.title), '[^a-z0-9]+', '-', 'g')), 60), ''),
    nullif(trim(both '-' from regexp_replace(lower(split_part(coalesce(f.site_url, f.url), '/', 3)), '[^a-z0-9]+', '-', 'g')), ''),
    'feed') || '/' || i.id) AS url) x
ORDER BY n.user_id, x.url, n.created_at
ON CONFLICT ("user_id", "url") DO NOTHING;--> statement-breakpoint
-- Copy each note onto its bookmark. Someone who noted the same story in two
-- feeds has one bookmark for it now; both notes are kept, oldest first, rather
-- than silently dropping one of them. Anything in the old, never-shown
-- bookmark note field is kept too, ahead of them.
WITH src AS (
  SELECT n.user_id,
         coalesce(i.url, '/feeds/' || f.id || '/' || coalesce(
           nullif(left(trim(both '-' from regexp_replace(lower(f.title), '[^a-z0-9]+', '-', 'g')), 60), ''),
           nullif(trim(both '-' from regexp_replace(lower(split_part(coalesce(f.site_url, f.url), '/', 3)), '[^a-z0-9]+', '-', 'g')), ''),
           'feed') || '/' || i.id) AS url,
         string_agg(n.body, E'\n\n' ORDER BY n.created_at, n.id) AS body,
         min(n.created_at) AS created_at,
         max(n.updated_at) AS updated_at
  FROM "notes" n
  JOIN "items" i ON i.id = n.item_id
  JOIN "feeds" f ON f.id = i.feed_id
  GROUP BY 1, 2
)
UPDATE "bookmarks" b
SET "note" = CASE WHEN nullif(btrim(b.note), '') IS NULL THEN src.body ELSE b.note || E'\n\n' || src.body END,
    "note_created_at" = src.created_at,
    "note_updated_at" = src.updated_at
FROM src
WHERE b.user_id = src.user_id AND b.url = src.url;--> statement-breakpoint
UPDATE "bookmarks" SET "note" = NULL WHERE "note" IS NOT NULL AND btrim("note") = '';--> statement-breakpoint
UPDATE "bookmarks" SET "note_created_at" = "saved_at", "note_updated_at" = "saved_at" WHERE "note" IS NOT NULL AND "note_created_at" IS NULL;--> statement-breakpoint
DROP TABLE "notes" CASCADE;--> statement-breakpoint
CREATE INDEX "bookmarks_noted_url_idx" ON "bookmarks" USING btree ("url") WHERE "bookmarks"."note" is not null;--> statement-breakpoint
CREATE INDEX "bookmarks_noted_item_idx" ON "bookmarks" USING btree ("item_id") WHERE "bookmarks"."note" is not null;
