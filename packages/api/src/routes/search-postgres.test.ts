import assert from "node:assert/strict";
import { test } from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { loadSearchBaseline, withSearchCorpus } from "../scripts/search-perf-fixture.js";

process.env.DATABASE_URL = "postgres://not-used-by-search-fixture";
const current = await import("./search.js");
const dialect = new PgDialect();

test("search matches full committed-baseline queries on a disposable PostgreSQL corpus", {
  skip: !process.env.MIGRATION_TEST_DATABASE_URL,
}, async (t) => {
  const baseline = await loadSearchBaseline();
  await withSearchCorpus(6500, async (pool) => {
    const client = await pool.connect();
    const db = drizzle(client);
    const exec = (query: SQL) => db.execute(query);
    // Freeze now() across both queries, including recency ranking.
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    try {
      await t.test("posts: every sort, broad/rare/absent/phrase terms, paging, network, blocks and windows", async () => {
        for (const q of ["news", "privacy", "mycorrhiza", "zzabsentzz", '"privacy news"', "news -privacy"]) {
          for (const sort of current.POST_SORTS) {
            for (const [net, since, offset] of [[null, null, 0], [[2], "365 days", 0], [[], null, 0], [null, "30 days", 5]] as const) {
              const args = [exec, q, 1, 7, offset, net && [...net], sort, since] as const;
              assert.deepEqual(await current.searchPosts(...args), await baseline.searchPosts(...args), `${q}/${sort}/${net}/${since}/${offset}`);
            }
          }
        }
      });
      await t.test("feeds: all four sorts keep sample ranking, exact counts, latest old/absent match and pagination", async () => {
        for (const q of ["news", "privacy", "mycorrhiza", "zzabsentzz"]) {
          for (const sort of current.FEED_SORTS) {
            for (const [net, since, offset] of [[null, null, 0], [[2], "365 days", 0], [[], null, 0], [null, "30 days", 3]] as const) {
              const args = [exec, q, 1, 50, offset, net && [...net], sort, since] as const;
              assert.deepEqual(await current.searchFeeds(...args), await baseline.searchFeeds(...args), `${q}/${sort}/${net}/${since}/${offset}`);
            }
          }
        }
        const feeds = await current.searchFeeds(exec, "privacy", 1, 50, 0);
        const namedOnly = feeds.rows.find((r) => r.id === 41)!;
        const old = feeds.rows.find((r) => r.id === 42)!;
        assert.equal(namedOnly.lastMatchAt, null);
        assert.equal(namedOnly.matchesLast30d, 0);
        assert.ok(old.lastMatchAt);
        assert.equal(old.matches, 0, "old name-matched feed falls outside 4000 newest sample");
        assert.equal(old.matchesLast30d, 0);
        assert.equal(feeds.rows.find((r) => r.id === 1)!.matchesLast30d, 1);
      });
      await t.test("collections: audience, copies, sorts and network semantics are unchanged", async () => {
        for (const viewer of [null, 1, 2, 3]) {
          for (const sort of current.COLLECTION_SORTS) {
            for (const net of [null, [], [2]]) {
              const args = [exec, "privacy", viewer, 25, 0, net, sort] as const;
              const result = await current.searchCollections(...args);
              assert.deepEqual(result, await baseline.searchCollections(...args));
              if (viewer !== 2) assert.ok(!result.rows.some((r) => r.id === 5), "private collection cannot leak");
            }
          }
        }
      });
      await t.test("post cap and filters are applied before sampling, and page boundaries are stable", async () => {
        const first = await current.searchPosts(exec, "privacy", 1, 50, 0, null, "newest");
        const second = await current.searchPosts(exec, "privacy", 1, 50, 50, null, "newest");
        assert.equal(first.total, 4000);
        assert.equal(first.capped, true);
        assert.equal(first.nextOffset, 50);
        assert.ok(first.rows.every((r) => r.feedId !== 4));
        assert.equal(new Set([...first.rows, ...second.rows].map((r) => r.id)).size, 100);
        const network = await current.searchPosts(exec, "privacy", 1, 50, 0, [2], "newest");
        assert.ok(network.total < 4000);
        assert.ok(network.rows.every((r) => [1, 2, 3, 4].includes(r.feedId)));
        const rare = await current.searchPosts(exec, "mycorrhiza", 1, 50, 0, null, "newest");
        assert.equal(rare.total, 1);
        assert.equal(rare.capped, false);
        const under = await current.searchPosts(exec, "boundaryunder", null, 1, 0, null, "newest");
        const exact = await current.searchPosts(exec, "boundaryexact", null, 1, 0, null, "newest");
        assert.equal(under.total, 3999);
        assert.equal(under.capped, false);
        assert.equal(exact.total, 4000);
        assert.equal(exact.capped, true, "a filled sample remains capped even at exactly 4000");
      });
      await t.test("fulltext barrier has no ordered/limited items scan", async () => {
        const capture = async (query: SQL) => {
          const compiled = dialect.sqlToQuery(query);
          assert.match(compiled.sql, /matching_posts as not materialized/);
          const matching = compiled.sql.split("matching_posts as not materialized (")[1].split("),")[0];
          assert.ok(!/order by|limit/i.test(matching), "fulltext lookup must precede ordering");
          assert.ok(!/select i\.\*/.test(matching), "candidate rows stay narrow");
          assert.match(matching, /offset 0/, "streaming barrier must not be flattened");
          return { rows: [] };
        };
        await current.searchPosts(capture, "news", 1, 25, 0, null, "newest");
        await current.searchFeeds(capture, "news", 1, 25, 0);
        const inspectPlan = async (query: SQL) => {
          const compiled = dialect.sqlToQuery(query);
          const result = await client.query(`EXPLAIN (FORMAT JSON) ${compiled.sql}`, compiled.params);
          const visit = (node: Record<string, any>) => {
            assert.ok(!(node["Index Name"] === "items_published_idx" && /search/.test(node.Filter ?? "")),
              "fulltext matching must not walk the chronological index");
            for (const child of node.Plans ?? []) visit(child);
          };
          visit(result.rows[0]["QUERY PLAN"][0].Plan);
          return { rows: [] };
        };
        for (const q of ["news", "privacy", "mycorrhiza", "zzabsentzz"]) {
          await current.searchPosts(inspectPlan, q, 1, 25, 0, null, "newest");
          await current.searchFeeds(inspectPlan, q, 1, 25, 0);
        }
      });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});
