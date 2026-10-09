/**
 * Apply pending SQL migrations from ./drizzle. Runs on every boot (see
 * index.ts) so "upgrade" is pull and restart, and can be run alone with
 * `pnpm db:migrate`. Migrations are generated with `pnpm db:generate` after a
 * schema change. Never edit applied SQL: its hash is its identity, so an edit
 * can replay it. CI rejects edits, and boot refuses likely checksum drift.
 *
 * Databases created before migrations existed (the original lab instance)
 * are baselined once with scripts/baseline.ts, which records the initial
 * migration as applied without running it.
 */
import { fileURLToPath } from "node:url";
import { pool } from "./client.js";
import { applyMigrations, readMigrations } from "./migrations.js";

export { MIGRATIONS_DIR } from "./migrations.js";

export async function runMigrations(log: (m: string) => void = console.log): Promise<void> {
  const started = Date.now();
  await applyMigrations(pool, readMigrations(), log);
  log(`[db] migration check finished (${Date.now() - started}ms)`);
}

// Direct invocation: pnpm db:migrate
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await runMigrations();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
