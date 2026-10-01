/**
 * Length limits on what a browser can send for a bookmark (issue #136).
 * Pure: no database, no server. Run with `pnpm --filter @thicket/api test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { BOOKMARK_FIELDS, fieldProblem } from "./bookmark-fields.js";
import { MAX_LENGTH } from "./ratelimit.js";

test("an ordinary bookmark passes, with or without its optional parts", () => {
  assert.equal(fieldProblem({ url: "https://example.com/post", title: "A post" }), null);
  assert.equal(fieldProblem({ url: "https://example.com/post", title: null, summary: null, author: undefined, siteTitle: null, imageUrl: null }), null);
  assert.equal(fieldProblem({}), null);
});

test("every field passes at exactly its limit and is refused one past it", () => {
  for (const field of BOOKMARK_FIELDS) {
    assert.equal(fieldProblem({ [field]: "x".repeat(MAX_LENGTH[field]) }), null, `${field} at the limit`);
    assert.match(fieldProblem({ [field]: "x".repeat(MAX_LENGTH[field] + 1) }) ?? "", /too long to save/, `${field} past the limit`);
  }
});

test("the refusal names the field in plain words and gives both numbers", () => {
  assert.equal(
    fieldProblem({ url: "https://example.com", siteTitle: "s".repeat(501) }),
    "That site name is too long to save: 501 characters, and the most is 500.",
  );
  assert.match(fieldProblem({ title: "t".repeat(6000) }) ?? "", /^That title is too long to save: 6,000 characters, and the most is 5,000\.$/);
  assert.match(fieldProblem({ url: "https://example.com/" + "a".repeat(4000) }) ?? "", /^That address is too long/);
});

test("something that is not text is refused rather than stored", () => {
  assert.equal(fieldProblem({ title: 42 }), "The title has to be text.");
  assert.equal(fieldProblem({ url: ["https://example.com"] }), "The address has to be text.");
  assert.equal(fieldProblem({ summary: { long: true } }), "The summary has to be text.");
});

test("the longest real values seen in feeds are well inside the limits, so Undo never fails on them", () => {
  // Longest stored on 2026-10-01: address 653, title 2,469, summary 280, author 1,725, feed name 143, image address 382,274.
  const seen = { url: 653, title: 2469, summary: 280, author: 1725, siteTitle: 143, imageUrl: 382_274 };
  for (const field of BOOKMARK_FIELDS) assert.ok(MAX_LENGTH[field] > seen[field], field);
  assert.equal(fieldProblem(Object.fromEntries(BOOKMARK_FIELDS.map((f) => [f, "x".repeat(seen[f])]))), null);
});
