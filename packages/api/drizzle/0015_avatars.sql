-- Profile pictures. One row per user, holding the image bytes right in
-- Postgres — the same way feed_icons holds site icons — so the single-volume
-- backup still captures every avatar and there's no disk or bucket to mount.
-- What lands here is already cropped square and shrunk to a small WebP on
-- upload, so rows stay a few KB. A user with no row renders a monogram, the
-- way a feed with no icon does.
create table "user_avatars" (
  "user_id" bigint primary key references "users"("id") on delete cascade,
  "content_type" text not null,
  "width" integer,
  "bytes" bytea not null,
  "hash" text not null,
  "updated_at" timestamptz not null default now()
);
