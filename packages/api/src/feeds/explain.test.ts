/**
 * Add-a-feed failures in plain words. No network, no database.
 * Run with `pnpm --filter @thicket/api test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

// These modules load the database client, which only needs an address to exist; nothing here connects.
process.env.DATABASE_URL ??= "postgres://unused/unused";
const { explainAddFailure, Explained } = await import("./explain.js");
const { HostCoolingDown, PAUSE_REASONS } = await import("./hosts.js");
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
  const said = explainAddFailure(new HostCoolingDown("reddit.com", new Date(Date.now() + 6 * 60_000), PAUSE_REASONS.slowDown), "https://www.reddit.com/r/svelte/new/.rss");
  assert.equal(said, "Reddit asked thicket to slow down. Try again in about 6 minutes.");
});

test("each kind of pause says what really happened", () => {
  const pause = (reason: string, mins = 20) => explainAddFailure(new HostCoolingDown("youtube.com", new Date(Date.now() + mins * 60_000), reason), "https://www.youtube.com/@x");
  assert.equal(pause(PAUSE_REASONS.outage), "YouTube’s feeds aren’t answering right now, so thicket is giving it a rest. Try again in about 20 minutes.");
  assert.equal(pause(PAUSE_REASONS.unavailable, 1), "YouTube says it’s temporarily unavailable. Try again in about 1 minute.");
  assert.equal(pause(PAUSE_REASONS.network), "YouTube’s hosting company asked thicket to slow down. Try again in about 20 minutes.");
  assert.equal(pause(PAUSE_REASONS.queued, 1), "thicket is busy fetching from YouTube right now. Try again in a minute.");
  assert.equal(pause(PAUSE_REASONS.networkQueued, 1), "thicket is busy fetching from YouTube right now. Try again in a minute.");
  for (const r of Object.values(PAUSE_REASONS)) assert.doesNotMatch(pause(r), /limiting/);
});


test("a message already written for readers passes through", () => {
  assert.equal(explainAddFailure(new Explained("Already plain."), url), "Already plain.");
});
