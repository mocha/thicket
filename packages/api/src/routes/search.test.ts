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
