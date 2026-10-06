/**
 * The page → data map for agents (issue #53) against the published API: every
 * endpoint it points at is a described GET that a read-only token may make.
 * Run with `pnpm --filter @thicket/api test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgres://not-used-by-tests";
const { DATA_FOR, dataForPath, llmsTxt, noscriptNote } = await import("./agents.js");
const { ENDPOINTS } = await import("./openapi.js");
const { tokenMay } = await import("./token-access.js");

const shape = (path: string) => path.split("?")[0].replace(/:[A-Za-z]+/g, ":p");
const described = new Set(ENDPOINTS.filter((e) => e.method === "GET").map((e) => shape(e.path)));

test("every endpoint a page points at is a described read", () => {
  for (const p of DATA_FOR) for (const d of p.data) {
    assert.ok(described.has(shape(d.api)), `${p.page} → ${d.api} is not in the API description`);
    assert.ok(tokenMay("read", "GET", d.api.split("?")[0].replace(/:[a-z]+/g, "1")).ok, `${d.api} refuses read-only tokens`);
  }
});

test("pages resolve to their data", () => {
  const apis = (path: string) => dataForPath(path).map((d) => d.api);
  assert.deepEqual(apis("/feeds/12/some-blog/345/a-post"), ["/api/items/345"]);
  assert.deepEqual(apis("/feeds/12/some-blog"), ["/api/feeds/12", "/api/river?feed=12"]);
  assert.deepEqual(apis("/feeds/12/settings"), []);
  assert.deepEqual(apis("/@pat/collections/tech%20news"), ["/api/profiles/pat/collections/tech%20news", "/api/profiles/pat/collections/tech%20news/opml"]);
  assert.deepEqual(apis("/@pat/notes"), ["/api/profiles/pat/bookmarks"]);
  assert.deepEqual(apis("/@pat"), ["/api/profiles/pat", "/api/profiles/pat/activity"]);
  assert.deepEqual(apis("/new-posts"), ["/api/river"]);
  assert.deepEqual(apis("/account"), []);
  assert.deepEqual(apis("/@%E0%A4%A"), [], "a malformed escape gets nothing, not an error");
});

test("the noscript note escapes and always points at llms.txt", () => {
  const note = noscriptNote("/@a\"b", "https://x.example");
  assert.ok(!note.includes('a"b'));
  assert.match(noscriptNote("/account", "https://x.example"), /https:\/\/x\.example\/llms\.txt/);
});

test("llms.txt lists every page", () => {
  const txt = llmsTxt("thicket", "https://x.example");
  assert.match(txt, /^# thicket\n\n> /);
  for (const p of DATA_FOR) assert.ok(txt.includes(`\`${p.page}\``), p.page);
  assert.match(txt, /https:\/\/x\.example\/api\/openapi\.json/);
});
