/**
 * A new account starts with no collections (issue #289). Against a real
 * database and a feed served from this process, this checks that:
 *
 * - sign-up makes only the hidden root, and nothing is made up behind the
 *   person's back: not by a follow with no name, not by a follow that fails,
 *   not by a restore, and not when they delete their last collection;
 * - following into a collection named in the same request makes it, once the
 *   feed is found;
 * - copying someone's collection into an empty account gives exactly that one.
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
import type { SessionUser } from "../lib/auth.js";

const testUrl = process.env.MIGRATION_TEST_DATABASE_URL;
// The modules below import the database client, which reads its address at import time.
process.env.DATABASE_URL ??= "postgres://not-used-when-skipped";

const DOC = `<?xml version="1.0"?>
<rss version="2.0"><channel><title>Lab notes</title><link>https://lab.example/</link><description>d</description>
<item><title>First</title><link>https://lab.example/1</link><guid>1</guid><pubDate>Mon, 12 Oct 2026 10:00:00 GMT</pubDate></item>
</channel></rss>`;

test("a new account starts with no collections, and nothing makes one by accident", { skip: !testUrl }, async (t) => {
  // The feed: one document. Anything else (including backfill's probes) is a 404.
  let hits = 0;
  const server = createServer((req, res) => {
    hits++;
    if (req.url !== "/feed.xml") return void res.writeHead(404).end();
    res.writeHead(200, { "content-type": "application/rss+xml" }).end(DOC);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const feedUrl = `${base}/feed.xml`;
  /** Until the server has gone quiet: following starts a backfill that doesn't wait to be done. */
  const settle = async () => { for (let n = -1; n !== hits;) { n = hits; await sleep(400); } };

  const admin = new pg.Pool({ connectionString: testUrl, max: 1 });
  const name = `thicket_first_collection_test_${process.pid}_${Date.now()}`;
  await admin.query(`CREATE DATABASE "${name}"`);
  const url = new URL(testUrl!);
  url.pathname = `/${name}`;
  process.env.DATABASE_URL = url.toString();
  const { pool, workerPool, endPools } = await import("../db/client.js");
  const closedConnections: Promise<void>[] = [];
  for (const p of [pool, workerPool]) p.on("connect", (client) => { closedConnections.push(new Promise((resolve) => client.once("end", resolve))); });
  const { applyMigrations, readMigrations } = await import("../db/migrations.js");
  const { createUser, rootCollectionOf } = await import("../lib/auth.js");
  const { feeds } = await import("./feeds.js");
  const { collections } = await import("./collections.js");
  const { profiles } = await import("./profiles.js");
  const rows = async <T = any>(text: string, values: unknown[] = []) => (await pool.query(text, values)).rows as T[];

  try {
    await applyMigrations(pool, readMigrations(), () => {});
    /** A real new account, as sign-up makes it. */
    const person = async (handle: string): Promise<SessionUser> => {
      const u = await createUser({ handle, password: "correct horse battery" });
      const rootCollectionId = (await rootCollectionOf(u.id))!;
      return { id: u.id, handle, displayName: null, rootCollectionId, defaultCollectionId: null, trackActivity: false };
    };
    /** The collections a person has, not counting the hidden root. */
    const theirs = (user: SessionUser) => rows<{ id: number; name: string; feeds: number }>(
      `select c.id, c.name, (select count(*)::int from collection_feeds f where f.collection_id = c.id) as feeds
       from collections c where c.user_id = $1 and c.parent_id is not null order by c.id`, [user.id]);
    const call = async (user: SessionUser, method: string, path: string, body?: unknown) => {
      const app = new Hono();
      app.use("*", async (c, next) => { c.set("user", user); await next(); });
      app.route("/api/feeds", feeds);
      app.route("/api/collections", collections);
      app.route("/api/profiles", profiles);
      const r = await app.request(path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: r.status, json: (await r.json()) as any };
    };

    await t.test("sign-up makes the hidden root and no other collection", async () => {
      const ann = await person("ann");
      const all = await rows<{ parent_id: number | null }>("select parent_id from collections where user_id = $1", [ann.id]);
      assert.equal(all.length, 1);
      assert.equal(all[0].parent_id, null);
      assert.deepEqual(await theirs(ann), []);
    });

    await t.test("following with no collection and no name is refused, and makes nothing", async () => {
      const bo = await person("bo");
      const r = await call(bo, "POST", "/api/feeds", { url: feedUrl });
      assert.equal(r.status, 400);
      assert.ok(typeof r.json.error === "string" && r.json.error.length > 0, "the answer says why");
      assert.deepEqual(await theirs(bo), []);
    });

    await t.test("following with a name makes that collection, holding the feed", async () => {
      const cy = await person("cy");
      const r = await call(cy, "POST", "/api/feeds", { url: feedUrl, newCollection: "Science" });
      assert.equal(r.status, 200);
      assert.equal(r.json.status, "subscribed");
      assert.deepEqual(await theirs(cy), [{ id: (await theirs(cy))[0].id, name: "Science", feeds: 1 }]);
      const held = await rows("select feed_id from collection_feeds cf join collections c on c.id = cf.collection_id where c.user_id = $1", [cy.id]);
      assert.deepEqual(held.map((h) => h.feed_id), [r.json.feed.id]);
      await settle();
    });

    await t.test("a follow that finds no feed leaves no collection behind", async () => {
      const di = await person("di");
      const r = await call(di, "POST", "/api/feeds", { url: `${base}/nothing`, newCollection: "Science" });
      assert.notEqual(r.status, 200);
      assert.deepEqual(await theirs(di), []);
      await settle();
    });

    await t.test("following a feed thicket knows: a name makes the collection; an unknown feed or no name makes nothing", async () => {
      const [{ id: feedId }] = await rows<{ id: number }>("select id from feeds limit 1");
      const ed = await person("ed");
      const none = await call(ed, "POST", `/api/feeds/${feedId}/follow`, {});
      assert.equal(none.status, 400);
      const unknown = await call(ed, "POST", "/api/feeds/999999/follow", { newCollection: "Science" });
      assert.equal(unknown.status, 404);
      assert.deepEqual(await theirs(ed), [], "neither failed follow made a collection");

      const ok = await call(ed, "POST", `/api/feeds/${feedId}/follow`, { newCollection: "Reading" });
      assert.equal(ok.status, 200);
      const made = await theirs(ed);
      assert.equal(made.length, 1);
      assert.equal(made[0].name, "Reading");
      assert.equal(made[0].feeds, 1);
    });

    await t.test("restoring with no collections to restore into makes none", async () => {
      const [{ id: feedId }] = await rows<{ id: number }>("select id from feeds limit 1");
      const flo = await person("flo");
      const r = await call(flo, "POST", `/api/feeds/${feedId}/restore`, { collectionIds: [] });
      assert.equal(r.status, 200);
      assert.deepEqual(r.json.collectionIds, []);
      assert.deepEqual(await theirs(flo), []);
    });

    await t.test("deleting the last collection leaves none, and none come back", async () => {
      const gus = await person("gus");
      const made = await call(gus, "POST", "/api/collections", { name: "Only one" });
      assert.equal(made.status, 201);
      const gone = await call(gus, "DELETE", `/api/collections/${made.json.id}`);
      assert.equal(gone.status, 200);
      assert.deepEqual(await theirs(gus), []);
      const listed = await call(gus, "GET", "/api/collections");
      assert.deepEqual(listed.json.collections.filter((c: any) => c.parentId !== null), []);
      assert.deepEqual(await theirs(gus), [], "reading the list made nothing");
    });

    await t.test("copying someone's public collection into an empty account gives just that collection", async () => {
      const [{ id: feedId }] = await rows<{ id: number }>("select id from feeds limit 1");
      const hana = await person("hana");
      const src = await call(hana, "POST", "/api/collections", { name: "Garden" });
      assert.equal(src.status, 201);
      await call(hana, "POST", `/api/feeds/${feedId}/follow`, { collectionId: src.json.id });
      await pool.query("update collections set visibility = 'public' where id = $1", [src.json.id]);

      const ivy = await person("ivy");
      const r = await call(ivy, "POST", `/api/profiles/hana/collections/${src.json.slug}/copy`, {});
      assert.equal(r.status, 201);
      const copied = await theirs(ivy);
      assert.equal(copied.length, 1);
      assert.equal(copied[0].name, "Garden");
      assert.equal(copied[0].feeds, 1);
    });
  } finally {
    await endPools();
    await Promise.all(closedConnections);
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.end();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
