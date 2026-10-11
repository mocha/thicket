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

test("an abandoned request's query is cancelled in Postgres", { skip: !testUrl }, async (t) => {
  const { cancellable, endPools, isDbBusy, pool } = await import("./client.js");
  try {
    await t.test("abort stops a running statement within moments, with Postgres's cancel code", async () => {
      const ac = new AbortController();
      const started = Date.now();
      setTimeout(() => ac.abort(), 200);
      await assert.rejects(
        cancellable(ac.signal, (q) => q(sql`select pg_sleep(5)`)),
        (e) => isDbBusy(e),
      );
      assert.ok(Date.now() - started < 2_000, `took ${Date.now() - started}ms`);
      const still = await pool.query("select count(*)::int n from pg_stat_activity where query like 'select pg_sleep(5)%' and state = 'active'");
      assert.equal(still.rows[0].n, 0);
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
