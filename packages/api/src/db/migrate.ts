/**
 * Apply pending SQL migrations from ./drizzle. Runs on every boot (see
 * index.ts) so "upgrade" is pull and restart, and can be run alone with
 * `pnpm db:migrate`. Migrations are generated with `pnpm db:generate` after a
 * schema change; never edit applied ones.
 *
 * Databases created before migrations existed (the original lab instance)
 * are baselined once with scripts/baseline.ts, which records the initial
 * migration as applied without running it.
 */
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./client.js";

export const MIGRATIONS_DIR = fileURLToPath(new URL("../../drizzle", import.meta.url));

export async function runMigrations(log: (m: string) => void = console.log): Promise<void> {
  const started = Date.now();
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  log(`[db] migrations up to date (${Date.now() - started}ms)`);
}

// Direct invocation: pnpm db:migrate
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await runMigrations();
  await pool.end();
}
