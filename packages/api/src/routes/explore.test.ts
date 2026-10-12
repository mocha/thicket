/**
 * The order of Explore's browse lists comes from ?sort=. Anything that isn't
 * one of a list's orders falls back to its default, which is the order the list
 * always had, so nothing changes for anyone who doesn't pick one. Never talks
 * to a database.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

// The router imports the database client, which wants an address at import time. It is never connected to here.
process.env.DATABASE_URL ??= "postgres://not-used-by-tests";
const {
  browseCollectionSortFrom, BROWSE_COLLECTION_SORTS, DEFAULT_BROWSE_COLLECTION_SORT,
  browsePeopleSortFrom, BROWSE_PEOPLE_SORTS, DEFAULT_BROWSE_PEOPLE_SORT,
} = await import("./explore.js");

test("each collections order is read as itself, anything else is the biggest first", () => {
  for (const s of BROWSE_COLLECTION_SORTS) assert.equal(browseCollectionSortFrom(s), s);
  for (const v of [undefined, null, "", "relevance", "NAME"]) assert.equal(browseCollectionSortFrom(v), "feeds");
  assert.equal(DEFAULT_BROWSE_COLLECTION_SORT, "feeds");
});

test("each people order is read as itself, anything else is by name", () => {
  for (const s of BROWSE_PEOPLE_SORTS) assert.equal(browsePeopleSortFrom(s), s);
  for (const v of [undefined, null, "", "followers", "relevance"]) assert.equal(browsePeopleSortFrom(v), "name");
  assert.equal(DEFAULT_BROWSE_PEOPLE_SORT, "name");
});
