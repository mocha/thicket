import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SessionUser } from "../lib/auth.js";

process.env.DATABASE_URL ??= "postgres://not-used-by-tests";
const { admin, feedSearch, FEED_TITLE_MAX } = await import("./admin.js");
const { db } = await import("../db/client.js");
const ME: SessionUser = { id: 7, handle: "admin", displayName: null, rootCollectionId: 1, defaultCollectionId: 2, trackActivity: false };
function app(user: SessionUser | null = ME) {
  const a = new Hono();
  a.use("*", async (c, next) => { c.set("user", user); await next(); });
  a.route("/api/admin", admin);
  return a;
}
const patch = (a: Hono, id: string, body?: string) => a.request(`/api/admin/feeds/${id}`, {
  method: "PATCH", headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body }),
});
// Only the authorization lookup is stubbed: rejected input must never reach an update.
function allowAdmin(t: TestContext) {
  t.mock.method(db, "select", () => ({ from: () => ({ where: async () => [{ isAdmin: true }] }) }));
}

test("subscription changes require a signed-in admin", async (t) => {
  assert.equal((await patch(app(null), "1", '{"requiresSubscription":true}')).status, 401);
  t.mock.method(db, "select", () => ({ from: () => ({ where: async () => [{ isAdmin: false }] }) }));
  assert.equal((await patch(app(), "1", '{"requiresSubscription":true}')).status, 403);
});

test("subscription changes reject missing, null, primitive, and nonboolean bodies before writing", async (t) => {
  allowAdmin(t);
  const update = t.mock.method(db, "update", () => { throw new Error("invalid input reached the database"); });
  for (const body of [undefined, "{", "null", "true", "42", '"text"', "[]", "{}", '{"requiresSubscription":null}', '{"requiresSubscription":"true"}', '{"requiresSubscription":0}']) {
    const r = await patch(app(), "1", body);
    assert.equal(r.status, 400, String(body));
    assert.deepEqual(await r.json(), { error: "requiresSubscription (boolean) or title (string or null) is required" });
  }
  assert.equal(update.mock.callCount(), 0);
});

test("subscription changes reject invalid and unsafe feed IDs before writing", async (t) => {
  allowAdmin(t);
  const update = t.mock.method(db, "update", () => { throw new Error("invalid ID reached the database"); });
  for (const id of ["nope", "NaN", "Infinity", "1.2", "0", "-1", "9007199254740992"]) {
    assert.equal((await patch(app(), id, '{"requiresSubscription":true}')).status, 404, id);
  }
  assert.equal(update.mock.callCount(), 0);
});

test("subscription changes accept both boolean values and report a missing feed", async (t) => {
  allowAdmin(t);
  let value: boolean | undefined;
  let found = true;
  t.mock.method(db, "update", () => ({ set: (patch: { requiresSubscription: boolean }) => {
    value = patch.requiresSubscription;
    return { where: () => ({ returning: async () => found ? [{ id: 1, requiresSubscription: value }] : [] }) };
  } }));
  for (const requiresSubscription of [true, false]) {
    const r = await patch(app(), "1", JSON.stringify({ requiresSubscription }));
    assert.equal(r.status, 200);
    assert.equal(value, requiresSubscription);
    assert.deepEqual(await r.json(), { id: 1, requiresSubscription });
  }
  found = false;
  assert.equal((await patch(app(), "999", '{"requiresSubscription":true}')).status, 404);
});

test("titles must be a string or null, alone or beside the paywall mark", async (t) => {
  allowAdmin(t);
  const update = t.mock.method(db, "update", () => { throw new Error("invalid input reached the database"); });
  for (const body of ['{"title":42}', '{"title":{}}', '{"title":[]}', '{"title":true}', '{"title":"x","requiresSubscription":"yes"}']) {
    assert.equal((await patch(app(), "1", body)).status, 400, body);
  }
  assert.equal(update.mock.callCount(), 0);
});

test("a title is trimmed and capped, and clearing it hands the title back to the feed's next check", async (t) => {
  allowAdmin(t);
  let set: Record<string, unknown> = {};
  t.mock.method(db, "update", () => ({ set: (patch: Record<string, unknown>) => {
    set = patch;
    return { where: () => ({ returning: async () => [{ id: 1, requiresSubscription: false, title: patch.title }] }) };
  } }));
  assert.equal((await patch(app(), "1", JSON.stringify({ title: "  The Verge  " }))).status, 200);
  assert.equal(set.title, "The Verge");
  assert.equal("etag" in set, false, "a title that is set leaves the next check alone");
  await patch(app(), "1", JSON.stringify({ title: "x".repeat(FEED_TITLE_MAX + 50) }));
  assert.equal((set.title as string).length, FEED_TITLE_MAX);
  for (const title of [null, "", "   "]) {
    await patch(app(), "1", JSON.stringify({ title }));
    assert.equal(set.title, null);
    assert.equal(set.etag, null);
    assert.equal(set.lastModified, null);
    assert.ok(set.nextFetchAt instanceof Date);
  }
  await patch(app(), "1", JSON.stringify({ title: "Both", requiresSubscription: true }));
  assert.deepEqual([set.title, set.requiresSubscription], ["Both", true]);
});

test("a new address needs a signed-in admin, a real feed id, and an address", async (t) => {
  const post = (a: Hono, id: string, body?: string) => a.request(`/api/admin/feeds/${id}/address`, {
    method: "POST", headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body }),
  });
  assert.equal((await post(app(null), "1", '{"url":"https://example.com/feed"}')).status, 401);
  allowAdmin(t);
  for (const id of ["nope", "0", "-1", "1.5"]) assert.equal((await post(app(), id, '{"url":"https://example.com/feed"}')).status, 404, id);
  for (const body of [undefined, "null", "{}", '{"url":""}', '{"url":"   "}', '{"url":42}']) assert.equal((await post(app(), "1", body)).status, 400, String(body));
  assert.equal((await post(app(), "1", '{"url":"ftp://example.com/feed"}')).status, 400);
});

test("feed search finds an address however it was pasted, and a feed by its number", () => {
  const dialect = new PgDialect();
  const render = (q: string) => { const s = feedSearch(q); return s ? dialect.sqlToQuery(s) : null; };
  assert.equal(render("   "), null);
  assert.equal(render("https://"), null);
  assert.deepEqual(render("https://www.example.com/feed/")!.params.slice(0, 1), ["%example.com/feed%"]);
  assert.deepEqual(render("http://Example.com")!.params.slice(0, 1), ["%Example.com%"]);
  assert.deepEqual(render("50%_off")!.params.slice(0, 1), ["%50\\%\\_off%"]);
  assert.ok(render("1234")!.sql.includes("f.id ="), "a number also matches the id");
  assert.ok(!render("verge")!.sql.includes("f.id ="));
});
