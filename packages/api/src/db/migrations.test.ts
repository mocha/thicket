import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import pg from "pg";
import { applyMigrations, auditMigrations, migrationChecklist, readMigrations, type Migration } from "./migrations.js";
import { auditTarget, runMigrationAudit } from "../scripts/audit-migrations.js";

function migration(tag: string, when: number, source: string): Migration {
  return { tag, when, hash: createHash("sha256").update(source).digest("hex"), statements: source.split("--> statement-breakpoint") };
}

test("an older missing migration stays pending, even at the same timestamp as an applied one", () => {
  const older = migration("older", 10, "SELECT 1");
  const newer = migration("newer", 20, "SELECT 2");
  const equal = migration("equal", 20, "SELECT 3");
  const next = migration("next", 30, "SELECT 4");
  const result = migrationChecklist([older, newer, equal, next], [{ hash: newer.hash, created_at: "20" }]);
  assert.deepEqual(result.applied, [newer]);
  assert.deepEqual(result.pending, [older, equal, next]);
  assert.deepEqual(result.skipped, [older, equal]);
});

test("changing only a migration's timestamp does not replay its SQL", () => {
  const original = migration("original", 10, "SELECT 1");
  const result = migrationChecklist([{ ...original, when: 100 }], [{ hash: original.hash, created_at: 10 }]);
  assert.deepEqual(result.pending, []);
});

test("the audit identifies ledger hashes absent from the checkout", () => {
  const record = { hash: "unmatched", created_at: 10 };
  assert.deepEqual(migrationChecklist([], [record]).unknown, [record]);
});

test("all checked-in migrations load in journal order with unique hashes", () => {
  const migrations = readMigrations();
  assert.ok(migrations.length > 0);
  assert.equal(new Set(migrations.map((m) => m.hash)).size, migrations.length);
  assert.equal(migrations[0].tag, "0000_spicy_emma_frost");
});

// Opt-in: the URL is an admin connection. All changes are confined to a newly
// created disposable database, never the database named by the URL itself.
const testUrl = process.env.MIGRATION_TEST_DATABASE_URL;
test("PostgreSQL migration regressions", { skip: !testUrl }, async (t) => {
  const admin = new pg.Pool({ connectionString: testUrl, max: 1 });
  const name = `thicket_migrations_test_${process.pid}_${Date.now()}`;
  await admin.query(`CREATE DATABASE "${name}"`);
  const url = new URL(testUrl!);
  url.pathname = `/${name}`;
  const pool = new pg.Pool({ connectionString: url.toString(), max: 4 });
  const closedConnections: Promise<void>[] = [];
  pool.on("connect", (client) => {
    closedConnections.push(new Promise((resolve) => client.once("end", resolve)));
  });
  const reset = async () => {
    await pool.query("DROP SCHEMA IF EXISTS drizzle CASCADE");
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");
  };
  try {
    await t.test("audit on an empty database creates nothing", async () => {
      const files = readMigrations();
      const result = await auditMigrations(pool, files);
      assert.deepEqual(result.pending, files);
      const logs: string[] = [];
      assert.equal(await runMigrationAudit(url.toString(), (m) => logs.push(m)), 0);
      assert.ok(logs[0].includes(`target ${auditTarget(url.toString())};`));
      assert.ok(logs.at(-1)?.includes(`${files.length} pending, 0 previously skipped, 0 unknown records`));
      const { rows } = await pool.query("SELECT to_regnamespace('drizzle') AS schema");
      assert.equal(rows[0].schema, null);
    });

    await t.test("unmatched newer ledger records warn without blocking missing migrations or older code", async () => {
      await reset();
      await applyMigrations(pool, [], () => {});
      await pool.query("INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)", ["newer-checkout-hash", 30]);
      const missing = migration("missing_older", 10, "CREATE TABLE missing_older (id integer)");
      const logs: string[] = [];
      await applyMigrations(pool, [missing], (m) => logs.push(m));
      assert.ok(logs.includes("[db] warning: 1 ledger record(s) match no migration file: newer-checkout-hash"));
      assert.ok(logs.includes("[db] applied missing_older"));
      assert.equal((await pool.query("SELECT * FROM drizzle.__drizzle_migrations")).rowCount, 2);
      await applyMigrations(pool, [missing], (m) => logs.push(m));
      assert.equal(logs.filter((m) => m.startsWith("[db] warning:")).length, 2);
      assert.equal(logs.filter((m) => m === "[db] applied missing_older").length, 1);
    });

    await t.test("edited data migrations refuse boot before any pending SQL can run", async () => {
      await reset();
      await pool.query("CREATE TABLE counter (n integer); INSERT INTO counter VALUES (0)");
      const applied = migration("increment", 10, "UPDATE counter SET n = n + 1");
      await applyMigrations(pool, [applied], () => {});
      const edited = migration(applied.tag, applied.when, applied.statements[0] + "\n-- comment edit");
      const otherwisePending = migration("other_pending", 20, "CREATE TABLE should_not_run (id integer)");
      const logs: string[] = [];
      await assert.rejects(applyMigrations(pool, [otherwisePending, edited], (m) => logs.push(m)), /migration increment failed: checksum differs from recorded history at timestamp 10/);
      assert.ok(logs[0].includes(applied.hash));
      assert.ok(!logs.some((m) => m.startsWith("[db] applying ")));
      assert.equal((await pool.query("SELECT n FROM counter")).rows[0].n, 1);
      assert.equal((await pool.query("SELECT to_regclass('should_not_run') AS table")).rows[0].table, null);
      assert.equal((await pool.query("SELECT * FROM drizzle.__drizzle_migrations")).rowCount, 1);
    });

    await t.test("older migration merged later runs once, with names in boot logs", async () => {
      await reset();
      await pool.query("CREATE TABLE markers (name text PRIMARY KEY)");
      const older = migration("older_pr", 10, "INSERT INTO markers VALUES ('older')");
      const newer = migration("newer_pr", 20, "INSERT INTO markers VALUES ('newer')");
      await applyMigrations(pool, [newer], () => {});
      const before = await pool.query("SELECT * FROM drizzle.__drizzle_migrations ORDER BY id");
      const audit = await auditMigrations(pool, [older, newer]);
      assert.deepEqual(audit.skipped, [older]);
      const after = await pool.query("SELECT * FROM drizzle.__drizzle_migrations ORDER BY id");
      assert.deepEqual(after.rows, before.rows, "audit leaves the ledger unchanged");
      const logs: string[] = [];
      await applyMigrations(pool, [older, newer], (m) => logs.push(m));
      assert.ok(logs.includes("[db] applied older_pr"));
      assert.ok(!logs.includes("[db] applied newer_pr"));
      await applyMigrations(pool, [{ ...older, when: 100 }, newer], (m) => logs.push(m));
      assert.ok(logs.includes("[db] migrations up to date; applied 0: none"));
      assert.equal((await pool.query("SELECT * FROM markers")).rowCount, 2);
      assert.equal((await pool.query("SELECT * FROM drizzle.__drizzle_migrations")).rowCount, 2);
    });

    await t.test("legacy baseline hashes are recognized without replaying the initial SQL", async () => {
      await reset();
      const first = migration("baseline", 10, "CREATE TABLE legacy (id integer)");
      const next = migration("after_baseline", 20, "ALTER TABLE legacy ADD COLUMN name text");
      await pool.query(first.statements[0]);
      await applyMigrations(pool, [], () => {});
      await pool.query("INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)", [first.hash, first.when]);
      await applyMigrations(pool, [first, next], () => {});
      assert.equal((await pool.query("SELECT name FROM legacy")).rowCount, 0);
      assert.equal((await pool.query("SELECT * FROM drizzle.__drizzle_migrations")).rowCount, 2);
    });

    await t.test("failure names the migration and reason, and rolls back SQL and ledger together", async () => {
      await reset();
      const first = migration("first", 10, "CREATE TABLE markers (id integer)");
      const broken = migration("broken_pr", 20, "ALTER TABLE markers ADD COLUMN name text;--> statement-breakpoint\nSELECT * FROM nonexistent_table");
      const logs: string[] = [];
      await assert.rejects(applyMigrations(pool, [first, broken], (m) => logs.push(m)), /migration broken_pr failed: relation "nonexistent_table" does not exist; transaction rolled back/);
      assert.ok(!logs.some((m) => m.startsWith("[db] applied ")));
      const { rows } = await pool.query("SELECT to_regclass('markers') AS markers, to_regclass('drizzle.__drizzle_migrations') AS ledger");
      assert.deepEqual(rows[0], { markers: null, ledger: null });
      // Retrying after correcting an unapplied migration succeeds.
      await applyMigrations(pool, [first, migration("broken_pr", 20, "ALTER TABLE markers ADD COLUMN name text")], () => {});
      assert.equal((await pool.query("SELECT * FROM drizzle.__drizzle_migrations")).rowCount, 2);
    });

    await t.test("overlapping boots do not apply the same migration twice", async () => {
      await reset();
      const slow = migration("slow", 10, "SELECT pg_sleep(0.15);--> statement-breakpoint\nCREATE TABLE once_only (id integer)");
      await Promise.all([applyMigrations(pool, [slow], () => {}), applyMigrations(pool, [slow], () => {})]);
      assert.equal((await pool.query("SELECT * FROM drizzle.__drizzle_migrations")).rowCount, 1);
    });

    await t.test("a unique violation retains the PostgreSQL detail in the startup error", async () => {
      await reset();
      const duplicate = migration("duplicate_values", 10, "CREATE TABLE duplicates (id integer); INSERT INTO duplicates VALUES (1), (1);--> statement-breakpoint\nCREATE UNIQUE INDEX duplicates_id ON duplicates (id)");
      await assert.rejects(applyMigrations(pool, [duplicate], () => {}), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /migration duplicate_values failed: could not create unique index "duplicates_id"/);
        assert.match(error.message, /detail: Key \(id\)=\(1\) is duplicated/);
        return true;
      });
    });

    await t.test("a deferred constraint failure is attributed to commit rather than the last migration", async () => {
      await reset();
      const deferred = migration("deferred_values", 10, "CREATE TABLE deferred_values (id integer UNIQUE DEFERRABLE INITIALLY DEFERRED); INSERT INTO deferred_values VALUES (1), (1)");
      const logs: string[] = [];
      await assert.rejects(applyMigrations(pool, [deferred], (m) => logs.push(m)), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /migration commit failed: duplicate key value violates unique constraint/);
        assert.match(error.message, /detail: Key \(id\)=\(1\) already exists/);
        return true;
      });
      assert.ok(!logs.some((m) => m.startsWith("[db] applied ")));
      assert.equal((await pool.query("SELECT to_regclass('deferred_values') AS table")).rows[0].table, null);
    });

    await t.test("every real migration applies on a fresh database and a second boot does nothing", async () => {
      await reset();
      const files = readMigrations();
      await applyMigrations(pool, files, () => {});
      const audit = await auditMigrations(pool, files);
      assert.equal(audit.applied.length, files.length);
      assert.deepEqual(audit.pending, []);
      assert.deepEqual(audit.unknown, []);
      const logs: string[] = [];
      await applyMigrations(pool, files, (m) => logs.push(m));
      assert.deepEqual(logs, ["[db] migrations up to date; applied 0: none"]);
    });
  } finally {
    await pool.end();
    // Pool shutdown can resolve before every client emits end. Wait for the
    // sockets to close before forcing the disposable database to drop.
    await Promise.all(closedConnections);
    await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin.end();
  }
});
