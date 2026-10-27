import assert from "node:assert/strict";
import { test } from "node:test";
import pg from "pg";
import { PgDialect } from "drizzle-orm/pg-core";
import { applyMigrations, readMigrations } from "../db/migrations.js";

// Do not read .env or borrow the application's write-capable connection.
process.env.DATABASE_URL ??= "postgres://not-used-by-retention-tests";
const { pruneFetchLog, pruneOldData, startRetention, FETCH_LOG_INTERVAL_MS, FETCH_LOG_LOCK } = await import("./retention.js");
const cutoff = "2026-10-13 03:00:00.123456+00";

function fakePool(options: {
  counts?: number[];
  backlog?: boolean;
  locked?: boolean;
  onDelete?: (n: number) => void;
  onLock?: () => Promise<void>;
  unlockFails?: boolean;
} = {}) {
  const calls: { text: string; values?: unknown[] }[] = [];
  let deletes = 0;
  let released: boolean | undefined;
  const client = {
    async query(text: string, values?: unknown[]) {
      calls.push({ text, values });
      if (text.includes("pg_try_advisory_lock")) {
        await options.onLock?.();
        return { rows: [{ locked: options.locked ?? true }] };
      }
      if (text.includes("as cutoff")) return { rows: [{ cutoff }] };
      if (text.includes("delete from fetch_log")) {
        deletes++;
        options.onDelete?.(deletes);
        return { rowCount: options.counts?.[deletes - 1] ?? 5_000, rows: [] };
      }
      if (text.includes("as backlog")) return { rows: [{ backlog: options.backlog ?? false }] };
      if (text.includes("pg_advisory_unlock")) {
        if (options.unlockFails) throw new Error("unlock failed");
        return { rows: [{ unlocked: true }] };
      }
      return { rowCount: 0, rows: [] };
    },
    release(destroy: boolean) { released = destroy; },
  };
  const pool = { connect: async () => client } as unknown as Pick<pg.Pool, "connect">;
  return { pool, calls, released: () => released };
}

test("fetch-log cleanup bounds, coordination, and failure recovery", async (t) => {
  t.mock.method(console, "log", () => {});
  t.mock.method(console, "warn", () => {});
  t.mock.method(console, "error", () => {});

  await t.test("disabled windows never borrow a connection", async () => {
    const f = fakePool();
    for (const days of [0, -1]) assert.equal((await pruneFetchLog({ pool: f.pool, days })).skipped, "disabled");
    assert.equal(f.calls.length, 0);
  });

  await t.test("one fixed precise cutoff, bounded chunks, oldest-first, and a backlog warning", async () => {
    const f = fakePool({ backlog: true });
    const r = await pruneFetchLog({ pool: f.pool });
    assert.equal(r.removed, 200_000);
    assert.equal(r.chunks, 40);
    assert.equal(r.cutoff, cutoff);
    assert.equal(r.backlog, true);
    assert.equal(r.budgetExhausted, true);
    const chunks = f.calls.filter((c) => c.text.includes("delete from fetch_log"));
    assert.equal(chunks.length, 40);
    for (const c of chunks) {
      assert.deepEqual(c.values, [cutoff, 5_000]);
      assert.match(c.text, /order by at limit/);
    }
    assert.equal(f.calls.filter((c) => c.text === "commit").length, 40);
    assert.equal(f.calls.filter((c) => c.text.includes("set local statement_timeout = '10s'")).length, 40);
    assert.equal(f.calls.filter((c) => c.text.includes("as cutoff")).length, 1);
    assert.equal(f.released(), false);
  });

  await t.test("a final full chunk with no backlog is not budget exhaustion", async () => {
    const r = await pruneFetchLog({ pool: fakePool().pool });
    assert.equal(r.chunks, 40);
    assert.equal(r.budgetExhausted, false);
  });

  await t.test("short and empty chunks stop early", async () => {
    for (const count of [0, 123]) {
      const r = await pruneFetchLog({ pool: fakePool({ counts: [count] }).pool });
      assert.equal(r.removed, count);
      assert.equal(r.chunks, 1);
      assert.equal(r.budgetExhausted, false);
    }
  });

  await t.test("elapsed budget stops between chunks without advancing the cutoff", async (t) => {
    let clock = 0;
    t.mock.method(Date, "now", () => clock);
    const f = fakePool({ backlog: true, onDelete: () => { clock += 15_000; } });
    const r = await pruneFetchLog({ pool: f.pool });
    assert.equal(r.removed, 10_000);
    assert.equal(r.chunks, 2);
    assert.equal(r.elapsedMs, 30_000);
    assert.equal(r.budgetExhausted, true);
  });

  await t.test("process-local overlapping calls skip before borrowing", async () => {
    let unlock!: () => void;
    const waiting = new Promise<void>((resolve) => { unlock = resolve; });
    const f = fakePool({ counts: [0], onLock: () => waiting });
    const first = pruneFetchLog({ pool: f.pool });
    const other = fakePool();
    assert.equal((await pruneFetchLog({ pool: other.pool })).skipped, "overlap");
    assert.equal(other.calls.length, 0);
    unlock();
    assert.equal((await first).skipped, null);
  });

  await t.test("another instance's advisory lock skips without deleting or unlocking it", async () => {
    const f = fakePool({ locked: false });
    assert.equal((await pruneFetchLog({ pool: f.pool })).skipped, "overlap");
    assert.equal(f.calls.length, 1);
    assert.equal(f.released(), false);
  });

  await t.test("failure rolls back only the failing chunk and destroys the locked session", async () => {
    const f = fakePool({ onDelete: (n) => { if (n === 2) throw new Error("delete timeout"); } });
    await assert.rejects(pruneFetchLog({ pool: f.pool }), /delete timeout/);
    assert.equal(f.calls.filter((c) => c.text === "commit").length, 1);
    assert.equal(f.calls.filter((c) => c.text === "rollback").length, 1);
    assert.equal(f.released(), true);
    assert.equal((await pruneFetchLog({ pool: fakePool({ counts: [0] }).pool })).skipped, null);
  });

  await t.test("unlock errors destroy the session and clear the local guard", async () => {
    const f = fakePool({ counts: [0], unlockFails: true });
    await assert.rejects(pruneFetchLog({ pool: f.pool }), /unlock failed/);
    assert.equal(f.released(), true);
    assert.equal((await pruneFetchLog({ pool: fakePool({ counts: [0] }).pool })).skipped, null);
  });

  await t.test("connection failure also clears the local guard", async () => {
    const pool = { connect: async () => { throw new Error("pool unavailable"); } } as unknown as Pick<pg.Pool, "connect">;
    await assert.rejects(pruneFetchLog({ pool }), /pool unavailable/);
    assert.equal((await pruneFetchLog({ pool: fakePool({ counts: [0] }).pool })).skipped, null);
  });
});

test("combined cleanup preserves daily event policy and leaves posts indefinite by default", async (t) => {
  const { workerPool, workerDb } = await import("../db/client.js");
  const f = fakePool({ counts: [0] });
  t.mock.method(workerPool, "connect", f.pool.connect);
  const statements: string[] = [];
  t.mock.method(workerDb, "execute", async (statement: Parameters<typeof workerDb.execute>[0]) => {
    statements.push(new PgDialect().sqlToQuery(statement as Parameters<PgDialect["sqlToQuery"]>[0]).sql);
    return { rowCount: 7, rows: [] };
  });
  t.mock.method(console, "log", () => {});
  assert.deepEqual(await pruneOldData(), { fetchLog: 0, events: 7, items: 0 });
  assert.equal(statements.length, 1);
  assert.match(statements[0], /delete from events/);
});
test("fetch-log cadence is hourly while event/post cadence remains daily", (t) => {
  const timeouts: number[] = [];
  const intervals: number[] = [];
  const timer = { unref() { return this; } };
  t.mock.method(globalThis, "setTimeout", (_fn: unknown, ms: number) => { timeouts.push(ms); return timer; });
  t.mock.method(globalThis, "setInterval", (_fn: unknown, ms: number) => { intervals.push(ms); return timer; });
  startRetention();
  assert.deepEqual(timeouts, [60_000, 60_000]);
  assert.deepEqual(intervals, [FETCH_LOG_INTERVAL_MS, 24 * 3600_000]);
});

const testUrl = process.env.MIGRATION_TEST_DATABASE_URL;
test("fetch-log PostgreSQL regression and >350k/day sustained cleanup", { skip: !testUrl }, async (t) => {
  const admin = new pg.Pool({ connectionString: testUrl, max: 1 });
  const name = `thicket_retention_test_${process.pid}_${Date.now()}`;
  await admin.query(`CREATE DATABASE "${name}"`);
  const url = new URL(testUrl!);
  url.pathname = `/${name}`;
  const pool = new pg.Pool({ connectionString: url.toString(), max: 4, statement_timeout: 120_000 });
  const closed: Promise<void>[] = [];
  pool.on("connect", (client) => { closed.push(new Promise((resolve) => client.once("end", resolve))); });
  const insertOld = (n: number) => pool.query(
    "insert into fetch_log(feed_id, at, status) select $1, now() - interval '15 days', 200 from generate_series(1, $2::int)",
    [feedId, n],
  );
  let feedId: number;
  try {
    await applyMigrations(pool, readMigrations(), () => {});
    feedId = (await pool.query("insert into feeds(url) values ('https://retention.test/feed') returning id")).rows[0].id;

    await t.test("age-leading index exists, and migration accepts an exact prebuilt index", async () => {
      const index = (await pool.query(`select i.indisvalid, i.indisready, pg_get_indexdef(i.indexrelid) as definition
        from pg_index i where i.indexrelid = 'fetch_log_at_idx'::regclass`)).rows[0];
      assert.equal(index.indisvalid, true);
      assert.equal(index.indisready, true);
      assert.match(index.definition, /USING btree \(at\)/);
      // Reapply only the index migration after removing its ledger record,
      // reproducing a concurrent prebuild followed by normal boot.
      const migration = readMigrations().find((m) => m.tag === "0032_fetch_log_retention")!;
      await pool.query("delete from drizzle.__drizzle_migrations where hash = $1", [migration.hash]);
      await applyMigrations(pool, readMigrations(), () => {});
    });

    await t.test("another session excludes cleanup, and release permits the next pass", async () => {
      const owner = await pool.connect();
      try {
        await owner.query("select pg_advisory_lock($1, $2)", [...FETCH_LOG_LOCK]);
        assert.equal((await pruneFetchLog({ pool })).skipped, "overlap");
        await owner.query("select pg_advisory_unlock($1, $2)", [...FETCH_LOG_LOCK]);
      } finally { owner.release(); }
      assert.equal((await pruneFetchLog({ pool })).skipped, null);
    });

    await t.test("default 14 days keeps recent outcomes; zero disables cleanup", async () => {
      await insertOld(3);
      await pool.query("insert into fetch_log(feed_id, at, status, items_new) values ($1, now() - interval '13 days', 304, 0), ($1, now(), 500, 0)", [feedId]);
      assert.equal((await pruneFetchLog({ pool, days: 0 })).removed, 0);
      assert.equal((await pool.query("select count(*)::int as n from fetch_log")).rows[0].n, 5);
      const result = await pruneFetchLog({ pool });
      assert.equal(result.removed, 3);
      assert.equal(result.backlog, false);
      assert.equal((await pool.query("select count(*)::int as n from fetch_log")).rows[0].n, 2);
    });

    await t.test("a row exactly at the fixed cutoff survives; one microsecond older does not", async () => {
      // Place the precise boundary rows on the same session immediately after
      // the real cutoff query, before its first delete.
      const boundaryPool = {
        async connect() {
          const client = await pool.connect();
          const query = client.query.bind(client);
          return {
            async query(text: string, values?: unknown[]) {
              const result = await query(text, values);
              if (text.includes("as cutoff")) {
                await query(`insert into fetch_log(feed_id, at) values
                  ($1, $2::timestamptz), ($1, $2::timestamptz - interval '1 microsecond')`,
                [feedId, result.rows[0].cutoff]);
              }
              return result;
            },
            release: client.release.bind(client),
          };
        },
      } as unknown as Pick<pg.Pool, "connect">;
      const r = await pruneFetchLog({ pool: boundaryPool });
      assert.equal(r.removed, 1);
      assert.equal((await pool.query("select count(*)::int n from fetch_log where at = $1::timestamptz", [r.cutoff])).rows[0].n, 1);
      await pool.query("delete from fetch_log where at = $1::timestamptz", [r.cutoff]);
    });

    await t.test("a 200,001-row backlog is bounded and drains on the next pass", async () => {
      await insertOld(200_001);
      const first = await pruneFetchLog({ pool });
      assert.equal(first.removed, 200_000);
      assert.equal(first.budgetExhausted, true);
      assert.equal(first.backlog, true);
      const next = await pruneFetchLog({ pool });
      assert.equal(next.removed, 1);
      assert.equal(next.backlog, false);
    });

    await t.test("a blocked chunk times out, earlier chunks stay committed, and the next pass recovers", async () => {
      await pool.query(`insert into fetch_log(feed_id, at)
        select $1, now() - interval '16 days' from generate_series(1, 5000)`, [feedId]);
      await insertOld(5_000);
      const blocker = await pool.connect();
      try {
        await blocker.query("begin");
        await blocker.query(`select id from fetch_log
          where at > now() - interval '15.5 days' and at < now() - interval '14 days'
          limit 1 for update`);
        await assert.rejects(pruneFetchLog({ pool }), (e: unknown) => (e as { code: string }).code === "55P03");
        assert.equal((await pool.query("select count(*)::int n from fetch_log where at < now() - interval '14 days'")).rows[0].n, 5_000);
      } finally {
        await blocker.query("rollback");
        blocker.release();
      }
      const recovery = await pruneFetchLog({ pool });
      assert.equal(recovery.skipped, null);
      assert.equal(recovery.removed, 5_000);
      assert.equal(recovery.backlog, false);
    });

    await t.test("three synthetic days at 400,008 expired rows/day keep zero hourly backlog", async () => {
      // Keep a 14-day-sized live cohort present, rather than benchmarking an
      // almost empty table. Only synthetic operational rows, not real data.
      await pool.query(`insert into fetch_log(feed_id, at, status)
        select $1, now() - interval '13 days', 304 from generate_series(1, 5600112)`, [feedId]);
      await pool.query("analyze fetch_log");
      const plan = (await pool.query(`explain (format json) select ctid from fetch_log
        where at < now() - interval '14 days' order by at limit 5000`)).rows[0]["QUERY PLAN"];
      assert.match(JSON.stringify(plan), /fetch_log_at_idx/);
      const durations: number[] = [];
      let deleted = 0;
      for (let hour = 0; hour < 72; hour++) {
        await insertOld(16_667);
        const r = await pruneFetchLog({ pool });
        assert.equal(r.removed, 16_667, `hour ${hour}`);
        assert.equal(r.backlog, false, `hour ${hour}`);
        assert.equal(r.budgetExhausted, false, `hour ${hour}`);
        deleted += r.removed;
        durations.push(r.elapsedMs);
      }
      assert.equal(deleted, 1_200_024);
      assert.equal((await pool.query("select count(*)::int n from fetch_log")).rows[0].n, 5_600_114);
      t.diagnostic(`synthetic 400008/day x 3 days; live cohort 5600112; deleted ${deleted}; max pass ${Math.max(...durations)}ms; total pass ${durations.reduce((a, b) => a + b, 0)}ms; age index used`);
    });
  } finally {
    await pool.end();
    await Promise.all(closed);
    await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin.end();
  }
});
