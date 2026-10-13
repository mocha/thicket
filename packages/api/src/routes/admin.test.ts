import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import type { SessionUser } from "../lib/auth.js";

process.env.DATABASE_URL ??= "postgres://not-used-by-tests";
const { admin } = await import("./admin.js");
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
    assert.deepEqual(await r.json(), { error: "requiresSubscription (boolean) is required" });
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

const get = (a: Hono, path: string) => a.request(`/api/admin${path}`);

test("a feed's and a post's categories are for signed-in admins only", async (t) => {
  const execute = t.mock.method(db, "execute", async () => { throw new Error("a non-admin reached the database"); });
  for (const path of ["/feeds/1/categories", "/items/1/categories"]) assert.equal((await get(app(null), path)).status, 401, path);
  t.mock.method(db, "select", () => ({ from: () => ({ where: async () => [{ isAdmin: false }] }) }));
  for (const path of ["/feeds/1/categories", "/items/1/categories"]) assert.equal((await get(app(), path)).status, 403, path);
  assert.equal(execute.mock.callCount(), 0);
});

test("categories reject invalid IDs before querying, and report what isn't there", async (t) => {
  allowAdmin(t);
  const execute = t.mock.method(db, "execute", async () => { throw new Error("invalid ID reached the database"); });
  for (const id of ["nope", "0", "-1", "1.5", "9007199254740992"]) {
    assert.equal((await get(app(), `/feeds/${id}/categories`)).status, 404, id);
    assert.equal((await get(app(), `/items/${id}/categories`)).status, 404, id);
  }
  assert.equal(execute.mock.callCount(), 0);
  execute.mock.mockImplementation(async () => ({ rows: [] }) as never);
  assert.equal((await get(app(), "/feeds/9/categories")).status, 404);
  assert.equal((await get(app(), "/items/9/categories")).status, 404);
});

test("a feed's categories: what it declares, and its posts' terms counted", async (t) => {
  allowAdmin(t);
  const answers = [
    { rows: [{ declared: ["science", "physics"], posts: 12, tagged: 9 }] },
    { rows: [{ term: "rust", posts: 7 }, { term: "python", posts: 3 }] },
  ];
  const execute = t.mock.method(db, "execute", async () => answers.shift() as never);
  const r = await get(app(), "/feeds/3/categories");
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { declared: ["science", "physics"], posts: 12, tagged: 9, terms: [{ term: "rust", posts: 7 }, { term: "python", posts: 3 }] });
  assert.equal(execute.mock.callCount(), 2);
});

test("a feed that declares nothing and whose posts carry nothing skips the count", async (t) => {
  allowAdmin(t);
  const execute = t.mock.method(db, "execute", async () => ({ rows: [{ declared: null, posts: 4, tagged: 0 }] }) as never);
  assert.deepEqual(await (await get(app(), "/feeds/3/categories")).json(), { declared: [], posts: 4, tagged: 0, terms: [] });
  assert.equal(execute.mock.callCount(), 1);
});

test("a post's categories, or none", async (t) => {
  allowAdmin(t);
  const answers = [{ rows: [{ categories: ["rust", "wasm"] }] }, { rows: [{ categories: null }] }];
  t.mock.method(db, "execute", async () => answers.shift() as never);
  assert.deepEqual(await (await get(app(), "/items/5/categories")).json(), { categories: ["rust", "wasm"] });
  assert.deepEqual(await (await get(app(), "/items/5/categories")).json(), { categories: [] });
});
