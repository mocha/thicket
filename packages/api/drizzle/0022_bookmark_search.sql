-- Search through bookmarks and notes (issue #98). ADDITIVE, like 0007: one
-- generated column and one index that code on an older revision never
-- selects, so rolling the application back does not need the schema rolled
-- back with it.
--
-- The vector covers what I saved and what I wrote: the title, my note, the
-- summary, the site name and the address. The address goes in twice: as it is,
-- so "example.com" finds it, and with its punctuation turned to spaces, so
-- "example" does too. The summary is cut at 20k characters so one enormous
-- one cannot blow the 1MB tsvector limit and fail every write to the row.
--
-- Both statements are safe to run twice, so a database that already has the
-- column (a shared development one, say) passes straight through.
ALTER TABLE "bookmarks" ADD COLUMN IF NOT EXISTS "search" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce("title", '')), 'A') || setweight(to_tsvector('english', coalesce("note", '')), 'B') || setweight(to_tsvector('english', left(coalesce("summary", ''), 20000)), 'C') || setweight(to_tsvector('english', coalesce("site_title", '') || ' ' || "url" || ' ' || regexp_replace("url", '[^[:alnum:]]+', ' ', 'g')), 'D')) STORED;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bookmarks_search_idx" ON "bookmarks" USING gin ("search");
