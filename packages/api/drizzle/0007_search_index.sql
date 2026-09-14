-- Search. Everything here is ADDITIVE: a column and four indexes that code on
-- an older revision never selects, so rolling the application back does not
-- need the schema rolled back with it.
--
-- Two tools, two jobs. Full-text (tsvector + GIN) handles posts, where stems
-- and phrases matter and the corpus is large. Trigram handles the name-ish
-- columns — feed titles, collection names, handles — which are short strings
-- people misremember and mistype, exactly full-text's blind spot.
--
-- pg_trgm installs per database, so this touches nothing else on the server.
create extension if not exists pg_trgm;--> statement-breakpoint
-- Weighted so a word in the title outranks the same word buried in the body.
-- content is raw feed HTML: the tags are stripped so the index does not fill up
-- with `div` and `href`, and it is cut at 120k characters so one enormous post
-- cannot blow the 1MB tsvector limit and fail every future write to the row.
ALTER TABLE "items" ADD COLUMN "search" tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
  setweight(to_tsvector('english', coalesce("summary", '')), 'B') ||
  setweight(to_tsvector('english', regexp_replace(left(coalesce("content", ''), 120000), '<[^>]*>', ' ', 'g')), 'C')
) STORED;--> statement-breakpoint
CREATE INDEX "items_search_idx" ON "items" USING gin ("search");--> statement-breakpoint
CREATE INDEX "feeds_title_trgm_idx" ON "feeds" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "feeds_description_trgm_idx" ON "feeds" USING gin ("description" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "collections_name_trgm_idx" ON "collections" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "users_handle_trgm_idx" ON "users" USING gin ("handle" gin_trgm_ops);
