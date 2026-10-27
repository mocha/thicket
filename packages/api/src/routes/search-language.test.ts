import assert from "node:assert/strict";
import { test } from "node:test";
import pg from "pg";

const testUrl = process.env.MIGRATION_TEST_DATABASE_URL;

test("Explore language filtering composes with search caps, sorts, and network filters", { skip: !testUrl }, async (t) => {
  const admin = new pg.Pool({ connectionString: testUrl, max: 1 });
  const name = `thicket_search_language_test_${process.pid}_${Date.now()}`;
  await admin.query(`CREATE DATABASE "${name}"`);
  const url = new URL(testUrl!);
  url.pathname = `/${name}`;
  process.env.DATABASE_URL = url.toString();
  const { pool, workerPool, endPools } = await import("../db/client.js");
  const closed: Promise<void>[] = [];
  for (const p of [pool, workerPool]) {
    p.on("connect", (client) => closed.push(new Promise((resolve) => client.once("end", resolve))));
  }
  const { applyMigrations, readMigrations } = await import("../db/migrations.js");
  const { Hono } = await import("hono");
  const { search } = await import("./search.js");
  const { feeds } = await import("./feeds.js");
  const q = async (text: string, values: unknown[] = []) => (await pool.query(text, values)).rows;
  const app = new Hono();

  try {
    await applyMigrations(pool, readMigrations(), () => {});
    const [viewer, owner] = await q("insert into users(handle) values ('viewer'), ('owner') returning id, handle");
    const [collection] = await q(
      "insert into collections(user_id,name,slug) values ($1,'Reading','reading') returning id",
      [owner.id],
    );
    await q("insert into user_follows(follower_id,followee_id) values ($1,$2)", [viewer.id, owner.id]);
    const [en, fr, unknown] = await q(`
      insert into feeds(url,title,language) values
        ('https://en.example/feed','Needle English','en'),
        ('https://fr.example/feed','Needle French','fr'),
        ('https://unknown.example/feed','Needle Unknown',null)
      returning id, language
    `);
    await q("insert into collection_feeds(collection_id,feed_id) values ($1,$2),($1,$3)", [collection.id, fr.id, unknown.id]);
    // More English matches than the global cap, all newer than the French
    // matches: filtering after the cap would wrongly return no French posts.
    await q(`
      insert into items(feed_id,dedupe_key,url,title,summary,published_at)
      select $1, n::text, 'https://en.example/' || n, 'Needle news', 'needle news',
             now() - n * interval '1 second'
      from generate_series(1,4005) n
    `, [en.id]);
    await q(`
      insert into items(feed_id,dedupe_key,url,title,summary,published_at) values
        ($1,'recent','https://fr.example/recent','Needle news','needle news',now()-interval '2 days'),
        ($1,'archive','https://fr.example/archive','Needle news','needle news',now()-interval '400 days'),
        ($2,'one','https://unknown.example/one','Needle news','needle news',now()-interval '3 days'),
        ($2,'two','https://unknown.example/two','Needle news','needle news',now()-interval '4 days'),
        ($2,'three','https://unknown.example/three','Needle news','needle news',now()-interval '5 days')
    `, [fr.id, unknown.id]);
    await q(`
      insert into bookmarks(user_id,item_id,feed_id,url,title,note,note_created_at,note_updated_at)
      select $1,id,feed_id,url,title,'A note',now(),now()
      from items where (feed_id=$2 and dedupe_key='1')
        or (feed_id=$3 and dedupe_key='recent') or (feed_id=$4 and dedupe_key='one')
    `, [viewer.id, en.id, fr.id, unknown.id]);
    app.use("*", async (c, next) => {
      c.set("user", {
        id: viewer.id, handle: viewer.handle, displayName: null,
        rootCollectionId: 0, defaultCollectionId: null, trackActivity: false,
      });
      await next();
    });
    app.route("/search", search);
    app.route("/feeds", feeds);
    const get = async (query: string) => {
      const response = await app.request(`/search?${query}`);
      assert.equal(response.status, 200, await response.clone().text());
      return response.json();
    };

    await t.test("specific and unknown languages are applied before the 4,000-hit cap", async () => {
      const all = (await get("scope=posts&q=needle")).posts;
      assert.equal(all.total, 4000);
      assert.equal(all.capped, true);
      const french = (await get("scope=posts&q=needle&language=fr")).posts;
      assert.equal(french.total, 2);
      assert.equal(french.capped, false);
      assert.ok(french.rows.every((p: any) => p.feedId === fr.id));
      const missing = (await get("scope=posts&q=needle&language=unknown")).posts;
      assert.equal(missing.total, 3);
      assert.ok(missing.rows.every((p: any) => p.feedId === unknown.id));
    });
    await t.test("post pagination, date windows, aliases, and relevance preserve the filter", async () => {
      const first = (await get("scope=posts&q=needle&language=fr-FR&limit=1")).posts;
      assert.equal(first.total, 2);
      assert.equal(first.nextOffset, 1);
      const second = (await get("scope=posts&q=needle&language=fr&limit=1&offset=1")).posts;
      assert.equal(second.nextOffset, null);
      assert.notEqual(first.rows[0].id, second.rows[0].id);
      assert.equal((await get("scope=posts&q=needle&language=fr&since=week")).posts.total, 1);
      const relevance = (await get("scope=posts&q=needle&language=fr&sort=relevance")).posts;
      assert.equal(relevance.total, 2);
      assert.ok(relevance.rows.every((p: any) => p.feedId === fr.id));
    });
    await t.test("feed evidence and exact mention counts use the selected language", async () => {
      for (const sort of ["about", "mentioned", "posted", "active"]) {
        const result = (await get(`scope=feeds&q=needle&language=fr&sort=${sort}`)).feeds;
        assert.equal(result.total, 1);
        assert.equal(result.rows[0].id, fr.id);
        assert.equal(result.rows[0].matches, 2);
        assert.equal(result.rows[0].matchesLast30d, 1);
      }
      const missing = (await get("scope=feeds&q=needle&language=unknown")).feeds;
      assert.equal(missing.total, 1);
      assert.equal(missing.rows[0].id, unknown.id);
    });
    await t.test("post browsing and saved orders filter with and without search words", async () => {
      for (const words of ["", "&q=needle"]) {
        for (const sort of ["newest", "bookmarked", "noted"]) {
          const result = (await get(`scope=posts&language=fr&sort=${sort}${words}`)).posts;
          assert.ok(result.rows.length > 0);
          assert.ok(result.rows.every((p: any) => p.feedId === fr.id));
        }
      }
    });
    await t.test("empty language preserves the default for every scope", async () => {
      for (const scope of ["posts", "feeds", "collections", "people"]) {
        assert.deepEqual(await get(`scope=${scope}&q=needle&language=`), await get(`scope=${scope}&q=needle`));
      }
    });
    await t.test("name-only feed matches obey the language even without post evidence", async () => {
      const [namedFrench] = await q(`
        insert into feeds(url,title,language) values
          ('https://named-fr.example/feed','OnlyName French','fr'),
          ('https://named-en.example/feed','OnlyName English','en')
        returning id
      `);
      for (const sort of ["about", "mentioned", "posted", "active"]) {
        const result = (await get(`scope=feeds&q=OnlyName&language=fr&sort=${sort}`)).feeds;
        assert.equal(result.total, 1);
        assert.equal(result.rows[0].id, namedFrench.id);
        assert.equal(result.rows[0].matches, 0);
        assert.equal(result.rows[0].nameMatch, true);
      }
    });
    await t.test("latest language pages merge feeds before global pagination and reject future posts", async () => {
      const [secondFrench] = await q("insert into feeds(url,title,language) values ('https://fr2.example/feed','French two','fr') returning id");
      await q(`
        insert into items(feed_id,dedupe_key,url,title,published_at) values
          ($1,'first','https://fr2.example/first','First',now()-interval '1 day'),
          ($1,'middle','https://fr2.example/middle','Middle',now()-interval '3 days'),
          ($1,'future','https://fr2.example/future','Future',now()+interval '1 day')
      `, [secondFrench.id]);
      const expected = await q("select id from items where feed_id=any($1::bigint[]) and published_at<=now() order by published_at desc,id desc", [[fr.id, secondFrench.id]]);
      const actual: number[] = [];
      for (let offset = 0; offset < expected.length; offset++) {
        const page = (await get(`scope=posts&language=fr&limit=1&offset=${offset}`)).posts;
        assert.equal(page.total, null);
        assert.equal(page.rows.length, 1);
        actual.push(page.rows[0].id);
        assert.equal(page.nextOffset, offset + 1 < expected.length ? offset + 1 : null);
      }
      assert.deepEqual(actual, expected.map((p) => p.id));
      const recent = (await get("scope=posts&language=fr&since=week")).posts;
      assert.equal(recent.rows.length, 3);
    });
    await t.test("saved stories choose their representative after language filtering", async () => {
      const copies = await q(`
        insert into items(feed_id,dedupe_key,url,title,published_at) values
          ($1,'shared','https://shared.example/story','Shared story',now()-interval '1 hour'),
          ($2,'shared','https://shared.example/story','Shared story',now()-interval '2 hours')
        returning id,feed_id
      `, [en.id, fr.id]);
      for (const [index, user] of [viewer, owner].entries()) {
        await q(`
          insert into bookmarks(user_id,item_id,feed_id,url,title,note,note_created_at,note_updated_at)
          values ($1,$2,$3,'https://shared.example/story','Shared story','Note',now(),now())
        `, [user.id, copies[index].id, copies[index].feed_id]);
      }
      for (const sort of ["bookmarked", "noted"]) {
        const selected = (await get(`scope=posts&language=fr&sort=${sort}`)).posts;
        assert.ok(selected.rows.some((p: any) => p.id === copies[1].id), "the older French copy stands for the saved story");
        assert.ok(selected.rows.every((p: any) => p.feedId === fr.id));
      }
    });
    await t.test("network and block restrictions compose with language", async () => {
      assert.equal((await get("scope=posts&q=needle&language=en&network=1")).posts.rows.length, 0);
      assert.equal((await get("scope=posts&q=needle&language=fr&network=1")).posts.total, 2);
      assert.equal((await get("scope=posts&language=en&network=1")).posts.rows.length, 0);
      assert.ok((await get("scope=posts&language=fr&network=1")).posts.rows.every((p: any) => p.feedId === fr.id));
      await q("insert into blocks(user_id,feed_id) values ($1,$2)", [viewer.id, unknown.id]);
      assert.equal((await get("scope=posts&q=needle&language=unknown")).posts.rows.length, 0);
      assert.equal((await get("scope=posts&language=unknown")).posts.rows.length, 0);
    });
    await t.test("invalid language errors are scoped, and empty filtered results are honest", async () => {
      for (const scope of ["feeds", "posts"]) {
        const response = await app.request(`/search?scope=${scope}&q=needle&language=not-a-language!`);
        assert.equal(response.status, 400);
        assert.equal((await response.json()).field, "language");
        const empty = (await get(`scope=${scope}&q=needle&language=de`))[scope];
        assert.equal(empty.total, 0);
        assert.deepEqual(empty.rows, []);
      }
      for (const scope of ["collections", "people"]) {
        assert.equal((await app.request(`/search?scope=${scope}&q=needle&language=invalid!`)).status, 200);
      }
    });
    await t.test("stored alias tags and canonical bases select equivalent feed and post results", async () => {
      const aliases = await q(`
        insert into feeds(url,title,language) values
          ('https://alias-tag.example/feed','Alias Serbian','sr-ME'),
          ('https://alias-base.example/feed','Alias Serbian base','sr')
        returning id
      `);
      for (const feed of aliases) {
        await q("insert into items(feed_id,dedupe_key,url,title,published_at) values ($1,'alias',$2,'Alias post',now()-interval '1 day')",
          [feed.id, `https://alias.example/${feed.id}`]);
      }
      for (const code of ["cnr", "sr-ME", "sr"]) {
        const feedsResult = (await get(`scope=feeds&q=alias&language=${code}`)).feeds;
        assert.equal(feedsResult.total, 2);
        for (const words of ["", "&q=alias"]) {
          const postsResult = (await get(`scope=posts&language=${code}${words}`)).posts;
          assert.equal(postsResult.rows.length, 2);
          assert.deepEqual(new Set(postsResult.rows.map((p: any) => p.feedId)), new Set(aliases.map((f) => f.id)));
        }
      }
    });
  } finally {
    await endPools();
    await Promise.all(closed);
    await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin.end();
  }
});
