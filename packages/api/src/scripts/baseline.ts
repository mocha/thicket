/**
 * One-time: mark the initial migration as already applied on a database that
 * was built with `drizzle-kit push` before migrations existed. After this,
 * boot-time migrate() applies only what's newer.
 *   pnpm db:baseline
 * Safe to re-run; does nothing if the migrations table already has rows.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { db, pool } from "../db/client.js";
import { MIGRATIONS_DIR } from "../db/migrate.js";

const journal = JSON.parse(readFileSync(join(MIGRATIONS_DIR, "meta", "_journal.json"), "utf8")) as { entries: { idx: number; when: number; tag: string }[] };
const first = journal.entries[0];
if (!first) throw new Error("no migrations in journal");

await db.execute(sql`create schema if not exists drizzle`);
await db.execute(sql`create table if not exists drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint)`);
const existing = await db.execute<{ n: number }>(sql`select count(*)::int as n from drizzle.__drizzle_migrations`);
if (existing.rows[0].n > 0) {
  console.log("migrations table already populated; nothing to do");
} else {
  const tables = await db.execute<{ n: number }>(sql`select count(*)::int as n from information_schema.tables where table_schema = 'public' and table_name = 'users'`);
  if (tables.rows[0].n === 0) throw new Error("this database is empty; just start the app and it will migrate itself");
  const hash = createHash("sha256").update(readFileSync(join(MIGRATIONS_DIR, `${first.tag}.sql`))).digest("hex");
  await db.execute(sql`insert into drizzle.__drizzle_migrations (hash, created_at) values (${hash}, ${first.when})`);
  console.log(`baselined at ${first.tag}`);
}
await pool.end();
