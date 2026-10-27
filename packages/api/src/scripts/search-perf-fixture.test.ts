import assert from "node:assert/strict";
import { test } from "node:test";
import pg from "pg";
import { withSearchCorpus } from "./search-perf-fixture.js";

test("search corpus rejects URL target overrides before attempting any connection", async (t) => {
  let connections = 0;
  let ran = false;
  t.mock.method(pg.Pool.prototype, "connect", () => {
    connections++;
    throw new Error("A rejected URL must never attempt a connection");
  });
  const previous = process.env.MIGRATION_TEST_DATABASE_URL;
  try {
    for (const suffix of [
      "?host=remote.example",
      "?hostaddr=203.0.113.7",
      "?%68ost=remote.example",
      "?host=127.0.0.1&host=remote.example",
      "?sslmode=disable",
      "#fragment",
    ]) {
      process.env.MIGRATION_TEST_DATABASE_URL = `postgresql://local_user@127.0.0.1:54329/postgres${suffix}`;
      await assert.rejects(withSearchCorpus(6500, async () => { ran = true; }), /without query parameters or fragments/);
    }
    process.env.MIGRATION_TEST_DATABASE_URL = "postgresql://local_user@remote.example/postgres";
    await assert.rejects(withSearchCorpus(6500, async () => { ran = true; }), /only permit a localhost/);
    process.env.MIGRATION_TEST_DATABASE_URL = "https://127.0.0.1/postgres";
    await assert.rejects(withSearchCorpus(6500, async () => { ran = true; }), /plain PostgreSQL URL/);
    assert.equal(connections, 0);
    assert.equal(ran, false);
  } finally {
    if (previous === undefined) delete process.env.MIGRATION_TEST_DATABASE_URL;
    else process.env.MIGRATION_TEST_DATABASE_URL = previous;
  }
});
