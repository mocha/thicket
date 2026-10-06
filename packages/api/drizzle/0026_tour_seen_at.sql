ALTER TABLE "users" ADD COLUMN "tour_seen_at" timestamp with time zone;--> statement-breakpoint
-- Accounts made before the setup tour existed skip it (issue #172).
UPDATE "users" SET "tour_seen_at" = now();
