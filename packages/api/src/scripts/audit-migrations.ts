/** Read-only pre-deploy comparison; never runs migrations or writes. */
import { fileURLToPath } from "node:url";
import pg from "pg";
import { auditMigrations, readMigrations, type migrationChecklist } from "../db/migrations.js";

export function auditDatabaseUrl(env: NodeJS.ProcessEnv): string {
  // Use exactly the runner's variable; an alternate endpoint must be explicit.
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  return env.DATABASE_URL;
}

export function auditTarget(connectionString: string): string {
  // Parse exactly as the driver does, including query overrides and PG defaults.
  const client = new pg.Client({ connectionString });
  // Never include username, password, or query options such as TLS key paths.
  return `${client.host}:${client.port}/${client.database}`;
}

export function auditExitCode(result: Pick<ReturnType<typeof migrationChecklist>, "skipped" | "unknown">): 0 | 1 {
  // Ordinary newer migrations are expected during upgrades.
  return result.skipped.length || result.unknown.length ? 1 : 0;
}

export async function runMigrationAudit(connectionString: string, log: (message: string) => void = console.log): Promise<0 | 1> {
  const target = auditTarget(connectionString);
  const migrations = readMigrations();
  log(`[db audit] ${new Date().toISOString()}; target ${target}; ${migrations.length} migration files; read only`);
  const pool = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 10_000 });
  try {
    const result = await auditMigrations(pool, migrations);
    const skipped = new Set(result.skipped.map((m) => m.hash));
    const applied = new Set(result.applied.map((m) => m.hash));
    for (const migration of migrations) {
      const status = applied.has(migration.hash) ? "applied" : skipped.has(migration.hash) ? "SKIPPED by old cutoff" : "pending";
      log(`[db audit] ${status}: ${migration.tag} (${migration.hash})`);
    }
    for (const record of result.unknown) {
      log(`[db audit] UNKNOWN recorded hash: ${record.hash} (stamp ${record.created_at})`);
    }
    log(`[db audit] ${result.applied.length} applied, ${result.pending.length} pending, ${result.skipped.length} previously skipped, ${result.unknown.length} unknown records`);
    return auditExitCode(result);
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    process.exitCode = await runMigrationAudit(auditDatabaseUrl(process.env));
  } catch (error) {
    console.error(`[db audit] failed: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  }
}
