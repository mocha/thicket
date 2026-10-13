/**
 * The order of a search's Feeds list comes from ?sort= (issue 182). Anything
 * that isn't one of the four orders falls back to the default, so an old or
 * mistyped link still loads. Never talks to a database.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

// The router imports the database client, which wants an address at import time. It is never connected to here.
process.env.DATABASE_URL ??= "postgres://not-used-by-tests";
const { feedSortFrom, FEED_SORTS, DEFAULT_FEED_SORT } = await import("./search.js");

test("each of the four orders is read as itself", () => {
  for (const s of FEED_SORTS) assert.equal(feedSortFrom(s), s);
});

test("anything else is the default", () => {
  for (const v of [undefined, null, "", "popular", "MENTIONED", "about "]) assert.equal(feedSortFrom(v), DEFAULT_FEED_SORT);
});

test("the default is most posts about the words", () => {
  assert.equal(DEFAULT_FEED_SORT, "about");
});

const {
  postSortFrom, POST_SORTS, DEFAULT_POST_SORT,
  collectionSortFrom, COLLECTION_SORTS, DEFAULT_COLLECTION_SORT,
  peopleSortFrom, PEOPLE_SORTS, DEFAULT_PEOPLE_SORT,
} = await import("./search.js");
const { sinceIntervalFrom } = await import("../lib/since.js");

// Every other list's order is read the same way: each named order is itself,
// anything else is that list's default.
for (const [name, from, sorts, fallback] of [
  ["posts", postSortFrom, POST_SORTS, DEFAULT_POST_SORT],
  ["collections", collectionSortFrom, COLLECTION_SORTS, DEFAULT_COLLECTION_SORT],
  ["people", peopleSortFrom, PEOPLE_SORTS, DEFAULT_PEOPLE_SORT],
] as const) {
  test(`${name}: each order is read as itself, anything else is the default`, () => {
    for (const s of sorts) assert.equal((from as (v: string) => string)(s), s);
    for (const v of [undefined, null, "", "followers", "NEWEST", "name "]) assert.equal((from as (v: unknown) => string)(v), fallback);
  });
}

test("posts can be ordered by how many people bookmarked or noted them, newest by default", () => {
  assert.deepEqual([...POST_SORTS], ["newest", "relevance", "bookmarked", "noted"]);
  assert.equal(DEFAULT_POST_SORT, "newest");
});

test("searched collections and people keep their relevance order by default, and never sort by followers", () => {
  assert.equal(DEFAULT_COLLECTION_SORT, "relevance");
  assert.equal(DEFAULT_PEOPLE_SORT, "relevance");
  assert.ok(!(PEOPLE_SORTS as readonly string[]).includes("followers"));
});

test("since reads the same four windows /api/feeds takes, and anything else is any time", () => {
  assert.equal(sinceIntervalFrom("24h"), "1 day");
  assert.equal(sinceIntervalFrom("week"), "7 days");
  assert.equal(sinceIntervalFrom("month"), "30 days");
  assert.equal(sinceIntervalFrom("year"), "365 days");
  for (const v of [undefined, null, "", "day", "toString", "constructor", "WEEK"]) assert.equal(sinceIntervalFrom(v), null);
});
