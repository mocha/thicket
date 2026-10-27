-- Large live tables: prebuild this exact index CONCURRENTLY outside the migration
-- transaction before deploying; see docs/DEPLOY.md, Fetch-log retention rollout.
-- Ordinary creation blocks writes until the migration batch commits. Bound lock
-- acquisition rather than leaving a boot queued behind a long-running writer.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fetch_log_at_idx" ON "fetch_log" USING btree ("at");
--> statement-breakpoint
SET LOCAL lock_timeout = DEFAULT;
