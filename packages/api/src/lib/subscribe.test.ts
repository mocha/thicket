/**
 * Following a feed, through POST /api/feeds, against a real database and a
 * feed served from this process. Two things the follow path once got wrong
 * (issue #189, review of PR #279):
 *
 * - The first fetch, made by discovery, must keep what the feed declares
 *   (its categories and language). It keeps the feed's ETag too, so the next
 *   check is a 304 that rewrites nothing; anything not stored here stayed
 *   missing until the feed changed.
 * - The follow response must not carry the feed's categories, which are for
 *   admins only for now, whether the feed is new to thicket or already known.
 *
 * Opt-in like the migration tests (docs/testing.md): set
 * MIGRATION_TEST_DATABASE_URL to an admin connection. Everything happens in a
 * disposable database that is dropped afterwards.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { Hono } from "hono";
import pg from "pg";
import type { SessionUser } from "./auth.js";

const testUrl = process.env.MIGRATION_TEST_DATABASE_URL;
// The modules below import the database client, which reads its address at import time.
process.env.DATABASE_URL ??= "postgres://not-used-when-skipped";

const ETAG = '"v1"';
const DOC = `<?xml version="1.0"?>
<rss version="2.0"><channel><title>Lab notes</title><link>https://lab.example/</link><description>d</description>
<language>en-US</language><category>Science</category><category>Field-Work</category>
<item><title>First</title><link>https://lab.example/1</link><guid>1</guid><category>Optics</category><pubDate>Mon, 12 Oct 2026 10:00:00 GMT</pubDate></item>
</channel></rss>`;

test("following keeps what the feed declares, and the response leaves its categories out", { skip: !testUrl }, async (t) => {
  // The feed: the document once, then "not modified" to anyone holding its ETag. Anything else (backfill's probes) is a 404.
  const seen: { path: string; ifNoneMatch: string | undefined }[] = [];
  const server = createServer((req, res) => {
    seen.push({ path: req.url ?? "", ifNoneMatch: req.headers["if-none-match"] as string | undefined });
    if (req.url !== "/feed.xml") return void res.writeHead(404).end();
    if (req.headers["if-none-match"] === ETAG) return void res.writeHead(304, { etag: ETAG }).end();
    res.writeHead(200, { "content-type": "application/rss+xml", etag: ETAG }).end(DOC);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const feedUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/feed.xml`;
  /** Until the server has gone quiet: following starts a backfill that doesn't wait to be done. */
  const settle = async () => { for (let n = -1; n !== seen.length;) { n = seen.length; await sleep(400); } };

  const admin = new pg.Pool({ connectionString: testUrl, max: 1 });
  const name = `thicket_subscribe_test_${process.pid}_${Date.now()}`;
  await admin.query(`CREATE DATABASE "${name}"`);
  const url = new URL(testUrl!);
  url.pathname = `/${name}`;
  process.env.DATABASE_URL = url.toString();
  const { pool, workerPool, endPools } = await import("../db/client.js");
  const closedConnections: Promise<void>[] = [];
  for (const p of [pool, workerPool]) p.on("connect", (client) => { closedConnections.push(new Promise((resolve) => client.once("end", resolve))); });
  const { applyMigrations, readMigrations } = await import("../db/migrations.js");
  const { refreshFeed } = await import("../feeds/refresh.js");
  const { feeds } = await import("../routes/feeds.js");
  const one = async <T = any>(text: string, values: unknown[] = []) => (await pool.query(text, values)).rows[0] as T;

  try {
    await applyMigrations(pool, readMigrations(), () => {});
    const person = async (handle: string): Promise<SessionUser> => {
      const u = await one<{ id: number }>("insert into users (handle) values ($1) returning id", [handle]);
      const root = await one<{ id: number }>("insert into collections (user_id, name, slug) values ($1, 'root', 'root') returning id", [u.id]);
      const a = await one<{ id: number }>("insert into collections (user_id, parent_id, name, slug) values ($1, $2, 'A', 'a') returning id", [u.id, root.id]);
      return { id: u.id, handle, displayName: null, rootCollectionId: root.id, defaultCollectionId: a.id, trackActivity: false };
    };
    const follow = async (user: SessionUser) => {
      const app = new Hono();
      app.use("*", async (c, next) => { c.set("user", user); await next(); });
      app.route("/api/feeds", feeds);
      const r = await app.request("/api/feeds", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: feedUrl }) });
      assert.equal(r.status, 200);
      return r.json() as Promise<{ status: string; alreadyFollowed: boolean; feed: Record<string, unknown> }>;
    };

    await t.test("a feed new to thicket: its first fetch keeps its categories and language", async () => {
      const out = await follow(await person("ann"));
      assert.equal(out.status, "subscribed");
      assert.equal(out.alreadyFollowed, false);
      assert.ok(!("categories" in out.feed), "the follow response carries no categories");
      const row = await one("select categories, language, etag from feeds where id = $1", [out.feed.id]);
      assert.deepEqual(row, { categories: ["science", "field work"], language: "en", etag: ETAG });
      assert.deepEqual((await one("select categories from items where feed_id = $1", [out.feed.id])).categories, ["optics"]);
      await settle();
    });

    await t.test("the next check is a 304, and what the feed declared is still there", async () => {
      const { id } = await one<{ id: number }>("select id from feeds");
      const before = seen.length;
      const r = await refreshFeed(id);
      assert.equal(r.status, 304);
      assert.ok(seen.slice(before).some((s) => s.path === "/feed.xml" && s.ifNoneMatch === ETAG), "the check sent the stored ETag");
      assert.deepEqual((await one("select categories, language from feeds where id = $1", [id])), { categories: ["science", "field work"], language: "en" });
    });

    await t.test("a feed thicket already has: following it still leaves its categories out", async () => {
      const out = await follow(await person("bo"));
      assert.equal(out.status, "subscribed");
      assert.equal(out.alreadyFollowed, true);
      assert.ok(!("categories" in out.feed), "the follow response carries no categories");
      await settle();
    });
  } finally {
    await endPools();
    await Promise.all(closedConnections);
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.end();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
