/**
 * cancellable(): a request's query stops in Postgres when its browser leaves,
 * not just in Node. Opt-in like the migration tests (docs/testing.md); it needs
 * a server to cancel on, but creates nothing in it.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { sql } from "drizzle-orm";

const testUrl = process.env.MIGRATION_TEST_DATABASE_URL;
process.env.DATABASE_URL = testUrl ?? "postgres://not-used-when-skipped";
// One request connection, so a test can make a request wait for it.
process.env.DB_POOL_MAX = "1";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("an abandoned request's query is cancelled in Postgres", { skip: !testUrl }, async (t) => {
  const { cancellable, endPools, isDbBusy, pool } = await import("./client.js");
  try {
    await t.test("abort stops a running statement within moments, with Postgres's cancel code", async () => {
      const ac = new AbortController();
      const started = Date.now();
      // Tagged so the check below finds this statement and not another run's on the same server.
      const tag = `cancel-test-${process.pid}-${Date.now()}`;
      setTimeout(() => ac.abort(), 200);
      await assert.rejects(
        cancellable(ac.signal, (q) => q(sql.raw(`select pg_sleep(5) /* ${tag} */`))),
        (e) => isDbBusy(e),
      );
      assert.ok(Date.now() - started < 2_000, `took ${Date.now() - started}ms`);
      // Nothing left running in Postgres. pg_stat_activity can trail the cancel by a moment, so allow one.
      let still = 1;
      for (let i = 0; i < 20 && still; i++) {
        still = (await pool.query("select count(*)::int n from pg_stat_activity where state = 'active' and query like $1", [`%${tag}%`])).rows[0].n;
        if (still) await sleep(25);
      }
      assert.equal(still, 0);
    });

    await t.test("abandoned while waiting for a connection: its statement never runs", async () => {
      const held = await pool.connect();
      const ac = new AbortController();
      const started = Date.now();
      let ran = false;
      const request = cancellable(ac.signal, async (q) => { ran = true; return q(sql`select pg_sleep(0.6)`); });
      await sleep(100);
      ac.abort();
      await sleep(50);
      held.release();
      await assert.rejects(request, { name: "AbortError" });
      assert.equal(ran, false);
      assert.ok(Date.now() - started < 500, `took ${Date.now() - started}ms`);
    });

    await t.test("abandoned between two statements: the second never runs", async () => {
      const ac = new AbortController();
      let second = 0;
      const request = cancellable(ac.signal, async (q) => {
        await q(sql`select 1`);
        ac.abort(); // nothing running to cancel: the backend is idle
        await sleep(100);
        const t0 = Date.now();
        try { return await q(sql`select pg_sleep(0.6)`); } finally { second = Date.now() - t0; }
      });
      await assert.rejects(request, { name: "AbortError" });
      assert.ok(second < 100, `second statement took ${second}ms`);
    });

    await t.test("the pool still works afterwards, and a finished request is untouched", async () => {
      const r = await cancellable(new AbortController().signal, (q) => q(sql`select 1 as one`));
      assert.equal(r.rows[0].one, 1);
    });

    await t.test("a request already abandoned never takes a connection", async () => {
      const ac = new AbortController();
      ac.abort();
      const before = pool.totalCount - pool.idleCount;
      await assert.rejects(cancellable(ac.signal, (q) => q(sql`select 1`)));
      assert.equal(pool.totalCount - pool.idleCount, before);
    });
  } finally {
    await endPools();
  }
});
