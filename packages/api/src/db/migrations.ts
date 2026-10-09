/** Hash-based migration checklist, compatible with Drizzle's existing ledger. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";

export const MIGRATIONS_DIR = fileURLToPath(new URL("../../drizzle", import.meta.url));

export interface Migration {
  tag: string;
  when: number;
  hash: string;
  statements: string[];
}

export interface MigrationRecord {
  hash: string;
  created_at: string | number | null;
}

export function readMigrations(folder = MIGRATIONS_DIR): Migration[] {
  const journal = JSON.parse(readFileSync(join(folder, "meta", "_journal.json"), "utf8")) as {
    entries: { tag: string; when: number }[];
  };
  const tags = new Set<string>();
  const hashes = new Set<string>();
  // Journal order defines dependencies; timestamps only remain as legacy metadata.
  return journal.entries.map(({ tag, when }) => {
    if (!/^[a-zA-Z0-9_-]+$/.test(tag) || !Number.isSafeInteger(when)) {
      throw new Error(`Invalid migration journal entry: ${tag}`);
    }
    const source = readFileSync(join(folder, `${tag}.sql`), "utf8");
    // Exactly the same bytes/encoding and hash as Drizzle and db:baseline.
    const hash = createHash("sha256").update(source).digest("hex");
    if (tags.has(tag) || hashes.has(hash)) throw new Error(`Duplicate migration: ${tag}`);
    tags.add(tag);
    hashes.add(hash);
    return { tag, when, hash, statements: source.split("--> statement-breakpoint") };
  });
}

export function migrationChecklist(migrations: Migration[], records: MigrationRecord[]) {
  const appliedHashes = new Set(records.map((r) => r.hash));
  const knownHashes = new Set(migrations.map((m) => m.hash));
  const latest = Math.max(-Infinity, ...records.map((r) => Number(r.created_at)));
  const pending = migrations.filter((m) => !appliedHashes.has(m.hash));
  return {
    applied: migrations.filter((m) => appliedHashes.has(m.hash)),
    pending,
    // These would have been silently skipped by the old timestamp cutoff.
    skipped: pending.filter((m) => m.when <= latest),
    unknown: records.filter((r) => !knownHashes.has(r.hash)),
  };
}

export async function applyMigrations(
  pool: Pool,
  migrations: Migration[],
  log: (message: string) => void = console.log,
): Promise<void> {
  const client = await pool.connect();
  let current: Migration | undefined;
  let committed = false;
  try {
    await client.query("BEGIN");
    // Serialize overlapping boots; read the ledger only after taking the lock.
    await client.query("SELECT pg_advisory_xact_lock(214208, 1)");
    await client.query("CREATE SCHEMA IF NOT EXISTS drizzle");
    await client.query(`CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id serial PRIMARY KEY, hash text NOT NULL, created_at bigint
    )`);
    const { rows } = await client.query<MigrationRecord>("SELECT hash, created_at FROM drizzle.__drizzle_migrations");
    const { pending } = migrationChecklist(migrations, rows);
    for (const migration of pending) {
      current = migration;
      log(`[db] applying ${migration.tag}`);
      for (const statement of migration.statements) {
        if (statement.trim()) await client.query(statement);
      }
      await client.query("INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)", [migration.hash, migration.when]);
    }
    await client.query("COMMIT");
    committed = true;
    // Only claim success once the batch is durable. Failed batches roll back in full.
    for (const migration of pending) log(`[db] applied ${migration.tag}`);
    log(`[db] migrations up to date; applied ${pending.length}: ${pending.map((m) => m.tag).join(", ") || "none"}`);
  } catch (error) {
    if (!committed) await client.query("ROLLBACK").catch(() => {});
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`[db] ${current ? `migration ${current.tag}` : "migration setup"} failed: ${reason}${committed ? "" : "; transaction rolled back"}`, { cause: error });
  } finally {
    client.release();
  }
}

/** No DDL or writes, even on an empty database. */
export async function auditMigrations(pool: Pool, migrations: Migration[]) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const { rows: tables } = await client.query<{ ledger: string | null }>("SELECT to_regclass('drizzle.__drizzle_migrations') AS ledger");
    const records = tables[0].ledger
      ? (await client.query<MigrationRecord>("SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id")).rows
      : [];
    const checklist = migrationChecklist(migrations, records);
    await client.query("COMMIT");
    return checklist;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
