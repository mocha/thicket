/** Read-only pre-deploy comparison; never imports or invokes the migrator. */
import pg from "pg";
import { auditMigrations, readMigrations } from "../db/migrations.js";

// Railway's Postgres service exposes its externally reachable URL separately.
const connectionString = process.env.DATABASE_PUBLIC_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");
const pool = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 10_000 });
try {
  const migrations = readMigrations();
  const result = await auditMigrations(pool, migrations);
  const skipped = new Set(result.skipped.map((m) => m.hash));
  const applied = new Set(result.applied.map((m) => m.hash));
  console.log(`[db audit] ${new Date().toISOString()}; ${migrations.length} migration files; read only`);
  for (const migration of migrations) {
    const status = applied.has(migration.hash) ? "applied" : skipped.has(migration.hash) ? "SKIPPED by old cutoff" : "pending";
    console.log(`[db audit] ${status}: ${migration.tag} (${migration.hash})`);
  }
  for (const record of result.unknown) {
    console.log(`[db audit] UNKNOWN recorded hash: ${record.hash} (stamp ${record.created_at})`);
  }
  console.log(`[db audit] ${result.applied.length} applied, ${result.pending.length} pending, ${result.skipped.length} previously skipped, ${result.unknown.length} unknown records`);
  // Missing files or unmatched history must be reviewed before deploying.
  if (result.pending.length || result.unknown.length) process.exitCode = 1;
} catch (error) {
  console.error(`[db audit] failed: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
