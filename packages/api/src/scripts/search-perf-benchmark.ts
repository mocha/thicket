/**
 * Run via benchmark:search with MIGRATION_TEST_DATABASE_URL and optionally
 * SEARCH_BENCH_ITEMS=100000 SEARCH_BENCH_FEEDS=8870 SEARCH_BENCH_ROUNDS=5
 * SEARCH_BENCH_MATCH_FRACTION=0.1 (also exercise 0.7 for ubiquitous terms).
 * Creates/drops its own DB.
 * Full result queries, not candidate-only probes; alternating warm repetitions
 * and bounded 2/4-query parallel batches. Not cold-cache, HTTP or production.
 * No planner changes.
 */
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { drizzle } from "drizzle-orm/node-postgres";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import type { CollectionSort, FeedSort, PostSort } from "../routes/search.js";
import { loadSearchBaseline, SEARCH_BASELINE, withSearchCorpus } from "./search-perf-fixture.js";

process.env.DATABASE_URL = "postgres://not-used-by-search-benchmark";
const current = await import("../routes/search.js");
const baseline = await loadSearchBaseline();
const size = Number(process.env.SEARCH_BENCH_ITEMS ?? 100_000);
const feedCount = Number(process.env.SEARCH_BENCH_FEEDS ?? 8870);
const matchFraction = Number(process.env.SEARCH_BENCH_MATCH_FRACTION ?? 0.1);
const rounds = Number(process.env.SEARCH_BENCH_ROUNDS ?? 5);
if (!Number.isInteger(rounds) || rounds < 1 || rounds > 20) throw new Error("SEARCH_BENCH_ROUNDS must be 1..20");
const dialect = new PgDialect();
type Scenario = {
  name: string;
  q: string;
  net?: number[];
  since?: string;
  offset?: number;
  feedSort?: FeedSort;
  postSort?: PostSort;
  collectionSort?: CollectionSort;
  concurrent?: boolean;
};
// Keep default measurements comparable, with bounded extra cases covering
// phrases/relevance, shared filters, and a non-first page.
const scenarios: Scenario[] = [
  ...["news", "privacy", "mycorrhiza", "zzabsentzz"].map((q) => ({
    name: `default-${q}`, q, concurrent: ["news", "privacy"].includes(q),
  })),
  { name: "multiword-relevance", q: '"privacy news"', postSort: "relevance", feedSort: "mentioned", collectionSort: "newest" },
  { name: "network-recent", q: "news", net: [2], since: "30 days", feedSort: "posted", collectionSort: "feeds" },
  { name: "paged-relevance", q: "news", offset: 25, postSort: "relevance", feedSort: "active" },
];

await withSearchCorpus(size, async (pool) => {
  const client = await pool.connect();
  const db = drizzle(client);
  const exec = (query: SQL) => db.execute(query);
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    console.log(JSON.stringify({ baseline: SEARCH_BASELINE, items: size + 2, feeds: feedCount, matchFraction, rounds,
      postgres: (await client.query("select version() as version")).rows[0].version,
      caveat: "Synthetic local corpus; interleaved warm full SQL queries and 2/4-query batches, not cold-cache, HTTP or production timings" }));
    for (const scenario of scenarios) {
      const { q, net = null, since = null, offset = 0 } = scenario;
      for (const scope of ["feeds", "posts", "collections"] as const) {
        const run = (impl: typeof current, x: (query: SQL) => Promise<{ rows: any[] }> = exec) => scope === "feeds"
          ? impl.searchFeeds(x, q, 1, 25, offset, net, scenario.feedSort ?? "about", since)
          : scope === "posts"
            ? impl.searchPosts(x, q, 1, 25, offset, net, scenario.postSort ?? "newest", since)
            : impl.searchCollections(x, q, 1, 25, offset, net, scenario.collectionSort ?? "relevance", since);
        assert.deepEqual(await run(current), await run(baseline), `${scope}/${scenario.name}`);
        const times: Record<string, number[]> = { baseline: [], current: [] };
        for (let round = 0; round < rounds; round++) {
          for (const key of round % 2 ? ["current", "baseline"] : ["baseline", "current"]) {
            const start = performance.now();
            await run(key === "current" ? current : baseline);
            times[key].push(performance.now() - start);
          }
        }
        const plans: Record<string, unknown> = {};
        for (const [key, impl] of [["baseline", baseline], ["current", current]] as const) {
          await run(impl, async (query: SQL) => {
            const compiled = dialect.sqlToQuery(query);
            const result = await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${compiled.sql}`, compiled.params);
            plans[key] = result.rows[0]["QUERY PLAN"][0];
            return { rows: [] };
          });
        }
        console.log(JSON.stringify({ scenario, q, scope, wallMs: times, plans }));
        if (scenario.concurrent && scope !== "collections") {
          for (const parallelism of [2, 4]) {
            for (const [variant, impl] of [["baseline", baseline], ["current", current]] as const) {
              const start = performance.now();
              const queryMs = await Promise.all(Array.from({ length: parallelism }, async () => {
                const connection = await pool.connect();
                try {
                  const parallelDb = drizzle(connection);
                  await connection.query("BEGIN READ ONLY");
                  const queryStart = performance.now();
                  await run(impl, (query) => parallelDb.execute(query));
                  return performance.now() - queryStart;
                } finally {
                  await connection.query("ROLLBACK");
                  connection.release();
                }
              }));
              console.log(JSON.stringify({ mode: "concurrent", scenario, q, scope, variant, parallelism, wallMs: performance.now() - start, queryMs }));
            }
          }
        }
      }
    }
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}, feedCount, matchFraction);
