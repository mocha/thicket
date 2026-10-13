/**
 * The stored sort counts (drizzle/0029, lib/counts.ts) against every way the
 * rows under them change: following and unfollowing, the same feed in two of
 * one person's collections, deleting a collection, an account, a feed, storing
 * posts through the real upsert, deleting posts, and folding one feed into
 * another. After each, the stored numbers must equal a fresh count, and the
 * nightly reconcile must find nothing to correct.
 *
 * Opt-in like the migration tests (docs/testing.md): set
 * MIGRATION_TEST_DATABASE_URL to an admin connection. Everything happens in a
 * disposable database that is dropped afterwards.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import pg from "pg";

const testUrl = process.env.MIGRATION_TEST_DATABASE_URL;
// The router-free modules below import the database client, which reads its address at import time.
process.env.DATABASE_URL ??= "postgres://not-used-when-skipped";

test("stored counts stay equal to a fresh count through every write path", { skip: !testUrl }, async (t) => {
  const admin = new pg.Pool({ connectionString: testUrl, max: 1 });
  const name = `thicket_counts_test_${process.pid}_${Date.now()}`;
  await admin.query(`CREATE DATABASE "${name}"`);
  const url = new URL(testUrl!);
  url.pathname = `/${name}`;
  process.env.DATABASE_URL = url.toString();
  const { pool, workerPool, endPools } = await import("../db/client.js");
  // Pool shutdown can resolve before every client emits end (as in db/migrations.test.ts):
  // wait for the sockets to close before forcing the disposable database to drop.
  const closedConnections: Promise<void>[] = [];
  for (const p of [pool, workerPool]) p.on("connect", (client) => { closedConnections.push(new Promise((resolve) => client.once("end", resolve))); });
  const { applyMigrations, readMigrations } = await import("../db/migrations.js");
  const { reconcile, recountWindows } = await import("./counts.js");
  const { mergeFeeds } = await import("../feeds/merge.js");
  const { storeItems } = await import("../feeds/refresh.js");
  const q = async <T = any>(text: string, values: unknown[] = []) => (await pool.query(text, values)).rows as T[];
  const one = async <T = any>(text: string, values: unknown[] = []) => (await q<T>(text, values))[0];

  /** Every stored count that differs from counting the rows right now. Empty is the pass. */
  const wrong = () => q(`
    select 'feed ' || f.id as row, f.follower_count as stored,
           (select count(distinct col.user_id)::int from collection_feeds cf join collections col on col.id = cf.collection_id where cf.feed_id = f.id) as actual, 'followers' as what
    from feeds f
    union all
    select 'feed ' || f.id, f.item_count, (select count(*)::int from items i where i.feed_id = f.id), 'items' from feeds f
    union all
    select 'collection ' || c.id, c.feed_count, (select count(*)::int from collection_feeds cf where cf.collection_id = c.id), 'feeds' from collections c
  `).then((rows) => rows.filter((r) => r.stored !== r.actual));

  try {
    await applyMigrations(pool, readMigrations(), () => {});
    const user = async (handle: string) => {
      const u = await one<{ id: number }>("insert into users (handle) values ($1) returning id", [handle]);
      const root = await one<{ id: number }>("insert into collections (user_id, name, slug) values ($1, 'root', 'root') returning id", [u.id]);
      const a = await one<{ id: number }>("insert into collections (user_id, parent_id, name, slug) values ($1, $2, 'A', 'a') returning id", [u.id, root.id]);
      const b = await one<{ id: number }>("insert into collections (user_id, parent_id, name, slug) values ($1, $2, 'B', 'b') returning id", [u.id, root.id]);
      return { id: u.id, a: a.id, b: b.id };
    };
    const feed = async (url: string) => (await one<{ id: number }>("insert into feeds (url) values ($1) returning id", [url])).id;
    const add = (collectionId: number, feedId: number) => q("insert into collection_feeds (collection_id, feed_id) values ($1, $2) on conflict do nothing", [collectionId, feedId]);
    const followers = async (feedId: number) => (await one<{ n: number }>("select follower_count as n from feeds where id = $1", [feedId])).n;
    const posts = (n: number, prefix: string, daysAgo = 1) => ({
      kind: "rss" as const, title: null, description: null, siteUrl: null, image: null, language: null, categories: [],
      items: Array.from({ length: n }, (_, k) => ({
        dedupeKey: `${prefix}-${k}`, url: `https://example.com/${prefix}/${k}`, title: `${prefix} ${k}`, author: null, summary: null,
        linkUrl: null, linkLabel: null, content: null, imageUrl: null, publishedAt: new Date(Date.now() - daysAgo * 86_400_000), categories: [],
      })),
    });

    const ann = await user("ann");
    const bo = await user("bo");
    const f1 = await feed("https://one.example/feed");
    const f2 = await feed("https://two.example/feed");
    const f3 = await feed("https://three.example/feed");

    await t.test("following counts each person once, however many of their collections hold the feed", async () => {
      await add(ann.a, f1);
      await add(ann.b, f1);
      await add(bo.a, f1);
      assert.equal(await followers(f1), 2);
      assert.deepEqual(await wrong(), []);
    });

    await t.test("unfollowing from one collection keeps the follow; from the last, drops it", async () => {
      await q("delete from collection_feeds where collection_id = $1 and feed_id = $2", [ann.a, f1]);
      assert.equal(await followers(f1), 2);
      await q("delete from collection_feeds where collection_id = $1 and feed_id = $2", [ann.b, f1]);
      assert.equal(await followers(f1), 1);
      assert.deepEqual(await wrong(), []);
    });

    await t.test("many rows in one statement, like an import", async () => {
      await q("insert into collection_feeds (collection_id, feed_id) select $1, unnest($2::bigint[])", [ann.a, [f1, f2, f3]]);
      assert.equal(await followers(f1), 2);
      assert.equal((await one("select feed_count from collections where id = $1", [ann.a])).feed_count, 3);
      assert.deepEqual(await wrong(), []);
    });

    await t.test("storing posts through the real upsert, again, and with bodies filled in", async () => {
      await storeItems(f2, posts(5, "p"));
      await storeItems(f2, posts(5, "p")); // all already held: nothing new
      const withBodies = posts(5, "p");
      for (const it of withBodies.items) (it as any).content = "<p>body</p>"; // the upsert's update path
      await storeItems(f2, withBodies);
      await storeItems(f2, posts(3, "old", 60));
      assert.equal((await one("select item_count from feeds where id = $1", [f2])).item_count, 8);
      assert.deepEqual(await wrong(), []);
    });

    await t.test("the hourly pass counts the 30- and 90-day windows", async () => {
      await recountWindows();
      const r = await one("select posts_30d, posts_90d from feeds where id = $1", [f2]);
      assert.deepEqual([r.posts_30d, r.posts_90d], [5, 8]);
    });

    await t.test("deleting posts, like retention", async () => {
      await q("delete from items where feed_id = $1 and dedupe_key like 'old-%'", [f2]);
      assert.equal((await one("select item_count from feeds where id = $1", [f2])).item_count, 5);
      assert.deepEqual(await wrong(), []);
    });

    await t.test("folding one feed into another moves its follows and posts", async () => {
      await storeItems(f3, posts(4, "q"));
      await add(bo.b, f3);
      await mergeFeeds(f3, f2);
      assert.equal((await one("select count(*)::int n from feeds where id = $1", [f3])).n, 0);
      assert.equal(await followers(f2), 2);
      assert.equal((await one("select item_count from feeds where id = $1", [f2])).item_count, 9);
      assert.deepEqual(await wrong(), []);
    });

    await t.test("deleting a collection, an account, and a feed", async () => {
      await q("delete from collections where id = $1", [bo.a]);
      assert.deepEqual(await wrong(), []);
      await q("delete from users where id = $1", [bo.id]);
      assert.equal(await followers(f2), 1);
      await q("delete from feeds where id = $1", [f1]);
      assert.deepEqual(await wrong(), []);
    });

    await t.test("two overlapping transactions, one adding a feed and one removing another, leave the right count and the collection listed", async () => {
      // PR #267 review: transaction 2's recount used to run before transaction 1
      // committed, count 0, and store it, hiding a public collection that still
      // held a feed from Explore until the nightly reconcile.
      const { Hono } = await import("hono");
      const { explore } = await import("../routes/explore.js");
      const app = new Hono();
      app.route("/", explore);
      const cy = await user("cy");
      const fa = await feed("https://a.example/feed");
      const fb = await feed("https://b.example/feed");
      await add(cy.a, fa);
      const listed = async () => {
        const cols = (await (await app.request("/collections?limit=50")).json()).collections.map((c: any) => c.id);
        const featured = (await (await app.request("/featured")).json()).collections.map((c: any) => c.id);
        return { cols: cols.includes(cy.a), featured: featured.includes(cy.a) };
      };
      assert.deepEqual(await listed(), { cols: true, featured: true });

      const t1 = await pool.connect();
      const t2 = await pool.connect();
      try {
        await t1.query("begin");
        await t1.query("insert into collection_feeds (collection_id, feed_id) values ($1, $2)", [cy.a, fb]);
        await t2.query("begin");
        const removing = t2.query("delete from collection_feeds where collection_id = $1 and feed_id = $2", [cy.a, fa]);
        await new Promise((r) => setTimeout(r, 200));
        await t1.query("commit");
        await removing;
        await t2.query("commit");
      } finally {
        t1.release();
        t2.release();
      }
      const r = await one("select feed_count as stored, (select count(*)::int from collection_feeds where collection_id = $1) as actual from collections where id = $1", [cy.a]);
      assert.deepEqual({ stored: r.stored, actual: r.actual }, { stored: 1, actual: 1 });
      assert.deepEqual(await listed(), { cols: true, featured: true });
      assert.deepEqual(await wrong(), []);
    });

    await t.test("the nightly reconcile finds nothing to correct, and fixes what it finds", async () => {
      assert.deepEqual(await reconcile(), { followers: 0, items: 0, collections: 0 });
      // Knock a number out of true behind the triggers' back, as a missed write would.
      await q("alter table feeds disable trigger user");
      await q("update feeds set follower_count = 99 where id = $1", [f2]);
      await q("alter table feeds enable trigger user");
      assert.deepEqual(await reconcile(), { followers: 1, items: 0, collections: 0 });
      assert.deepEqual(await wrong(), []);
    });
  } finally {
    await endPools();
    await Promise.all(closedConnections);
    await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin.end();
  }
});
