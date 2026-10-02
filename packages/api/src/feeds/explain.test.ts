/**
 * Add-a-feed failures in plain words. No network, no database.
 * Run with `pnpm --filter @thicket/api test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

// These modules load the database client, which only needs an address to exist; nothing here connects.
process.env.DATABASE_URL ??= "postgres://unused/unused";
const { explainAddFailure, Explained } = await import("./explain.js");
const { HostCoolingDown } = await import("./hosts.js");
const { BadStatus } = await import("./http.js");

const url = "https://blog.example.com/posts";

test("no raw error text reaches the reader", () => {
  const failures: unknown[] = [
    new BadStatus(`HTTP 404 fetching ${url}`, 404),
    new BadStatus(`HTTP 403 fetching ${url}`, 403),
    new BadStatus(`HTTP 503 fetching ${url}`, 503),
    new TypeError("fetch failed", { cause: { code: "ENOTFOUND" } }),
    new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } }),
    new DOMException("The operation was aborted due to timeout", "TimeoutError"),
    new Error("some internal thing nobody planned for"),
    "a thrown string",
  ];
  for (const f of failures) {
    const said = explainAddFailure(f, url);
    assert.doesNotMatch(said, /HTTP|fetch|ENOTFOUND|ECONN|Error|internal/, said);
    assert.match(said, /\.$|\)\.?$/, said);
  }
});

test("names the site and what to do", () => {
  assert.equal(explainAddFailure(new BadStatus("x", 404), url), "example.com says there’s nothing at that address. Check it and try again.");
  assert.equal(explainAddFailure(new TypeError("fetch failed", { cause: { code: "ENOTFOUND" } }), url), "There’s no site at example.com. Check the spelling and try again.");
});

test("a site that asked us to wait says how long, by its everyday name", () => {
  const said = explainAddFailure(new HostCoolingDown("reddit.com", new Date(Date.now() + 6 * 60_000), "asked thicket to slow down"), "https://www.reddit.com/r/svelte/new/.rss");
  assert.equal(said, "Reddit is limiting how often thicket can ask for its feeds. Try again in about 6 minutes.");
});

test("a message already written for readers passes through", () => {
  assert.equal(explainAddFailure(new Explained("Already plain."), url), "Already plain.");
});
