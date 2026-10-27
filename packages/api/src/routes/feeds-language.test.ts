/**
 * Opt-in against a disposable database only. The admin URL creates a fresh DB,
 * and no application query connects to the database named by that URL.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Hono } from "hono";
import pg from "pg";
import type { SessionUser } from "../lib/auth.js";

const testUrl = process.env.MIGRATION_TEST_DATABASE_URL;
process.env.DATABASE_URL ??= "postgres://not-used-when-skipped";

test("feed language browse filters, counts and options", { skip: !testUrl }, async (t) => {
  const admin = new pg.Pool({ connectionString: testUrl, max: 1 });
  const name = `thicket_language_test_${process.pid}_${Date.now()}`;
  await admin.query(`CREATE DATABASE "${name}"`);
  const url = new URL(testUrl!);
  url.pathname = `/${name}`;
  process.env.DATABASE_URL = url.toString();
  const { pool, workerPool, endPools } = await import("../db/client.js");
  const closed: Promise<void>[] = [];
  for (const p of [pool, workerPool]) p.on("connect", (client) => closed.push(new Promise((resolve) => client.once("end", resolve))));
  const { applyMigrations, readMigrations } = await import("../db/migrations.js");
  const { feeds } = await import("./feeds.js");
  try {
    await applyMigrations(pool, readMigrations(), () => {});
    const [{ id: userId }] = (await pool.query("insert into users (handle) values ('language_reader') returning id")).rows;
    const [{ id: rootCollectionId }] = (await pool.query("insert into collections (user_id, name, slug) values ($1, 'Root', 'root') returning id", [userId])).rows;
    const [{ id: friendId }] = (await pool.query("insert into users (handle) values ('language_friend') returning id")).rows;
    const [{ id: collectionId }] = (await pool.query("insert into collections (user_id, name, slug) values ($1, 'Reading', 'reading') returning id", [friendId])).rows;
    await pool.query("insert into user_follows (follower_id, followee_id) values ($1,$2)", [userId, friendId]);
    const ids: number[] = [];
    for (const [i, language] of [null, "en", "de", "en", "fil"].entries()) {
      const [{ id }] = (await pool.query("insert into feeds (url, title, language, kind, created_at) values ($1,$2,$3,'rss',now()-$4::interval) returning id",
        [`https://language.example/${i}`, `Language ${i}`, language, i === 3 ? "2 years" : "1 hour"])).rows;
      ids.push(id);
    }
    await pool.query("insert into collection_feeds (collection_id, feed_id) values ($1,$2),($1,$3)", [collectionId, ids[1], ids[2]]);
    const user: SessionUser = { id: userId, handle: "language_reader", displayName: null, rootCollectionId, defaultCollectionId: null, trackActivity: false };
    const app = new Hono();
    app.use("*", async (c, next) => { c.set("user", user); await next(); });
    app.route("/api/feeds", feeds);
    const call = async (query: string) => {
      const res = await app.request(`/api/feeds${query}`);
      return { status: res.status, json: await res.json() as any };
    };

    await t.test("All is default, Unknown is only SQL NULL, and tags normalize", async () => {
      for (const query of ["", "?language="]) {
        const r = await call(query);
        assert.equal(r.status, 200);
        assert.equal(r.json.total, 5);
      }
      const unknown = await call("?language=unknown");
      assert.equal(unknown.json.total, 1);
      assert.equal(unknown.json.feeds[0].id, ids[0]);
      const english = await call("?language=ENG");
      assert.equal(english.json.total, 2);
      assert.equal(english.json.indexTotal, 5);
      assert.deepEqual(new Set(english.json.feeds.map((f: any) => f.id)), new Set([ids[1], ids[3]]));
    });
    await t.test("filter applies before pagination, and all pages retain matching total", async () => {
      const first = await call("?language=en-US&sort=title&limit=1");
      assert.equal(first.json.total, 2);
      assert.deepEqual(first.json.feeds.map((f: any) => f.id), [ids[1]]);
      assert.equal(first.json.nextOffset, 1);
      const second = await call("?language=en&sort=title&limit=1&offset=1");
      assert.equal(second.json.total, 2);
      assert.deepEqual(second.json.feeds.map((f: any) => f.id), [ids[3]]);
      assert.equal(second.json.nextOffset, null);
    });
    await t.test("language composes with query, time and network filters", async () => {
      const recent = await call("?language=en&since=week");
      assert.equal(recent.json.total, 1);
      const network = await call("?language=en&network=1");
      assert.deepEqual(network.json.feeds.map((f: any) => f.id), [ids[1]]);
      const empty = await call("?language=de&q=Language%201");
      assert.equal(empty.json.total, 0);
      assert.deepEqual(empty.json.feeds, []);
      assert.equal(empty.json.nextOffset, null);
    });
    await t.test("bad values are validation errors, valid absent language is empty", async () => {
      for (const value of ["English", "en-", "all languages"]) {
        const r = await call(`?language=${encodeURIComponent(value)}`);
        assert.equal(r.status, 400);
        assert.equal(r.json.field, "language");
      }
      const missing = await call("?language=ja");
      assert.equal(missing.status, 200);
      assert.equal(missing.json.total, 0);
    });
    await t.test("options read distinct stored languages, independent of current filters", async () => {
      const r = await call("/languages?language=ja&network=1&q=absent");
      assert.equal(r.status, 200);
      assert.deepEqual(r.json.languages, [
        { code: "en", label: "English" }, { code: "fil", label: "Filipino" }, { code: "de", label: "German" },
      ]);
    });
    await t.test("stored regional aliases round-trip through grouped options and canonical queries", async () => {
      const { feedLanguage } = await import("../feeds/parse.js");
      const groups = [
        { inputs: ["cnr", "sr-ME", "sr"], stored: "sr-ME", base: "sr" },
        { inputs: ["drw", "prs", "fa-AF", "fa"], stored: "fa-AF", base: "fa" },
        { inputs: ["swc", "sw-CD", "sw"], stored: "sw-CD", base: "sw" },
      ];
      for (const group of groups) {
        assert.equal(feedLanguage(group.inputs[0]), group.stored, "fixture reproduces existing metadata normalization");
        const expectedIds: number[] = [];
        for (const stored of [group.stored, group.base]) {
          const [{ id }] = (await pool.query("insert into feeds (url, title, language) values ($1,$2,$3) returning id",
            [`https://language.example/alias/${stored}`, stored, stored])).rows;
          expectedIds.push(id);
        }
        for (const input of group.inputs) {
          const r = await call(`?language=${encodeURIComponent(input)}`);
          assert.equal(r.status, 200);
          assert.equal(r.json.total, 2);
          assert.deepEqual(new Set(r.json.feeds.map((f: any) => f.id)), new Set(expectedIds));
        }
      }
      const options = (await call("/languages")).json.languages;
      for (const group of groups) {
        assert.equal(options.filter((l: any) => l.code === group.base).length, 1);
        assert.ok(!options.some((l: any) => l.code === group.stored));
        const result = await call(`?language=${group.base}`);
        assert.equal(result.json.total, 2, "every grouped option selects its historical and base rows");
      }
      assert.equal((await call("")).json.total, 11);
      assert.equal((await call("?language=unknown")).json.total, 1);
    });
  } finally {
    await endPools();
    await Promise.all(closed);
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.end();
  }
});
