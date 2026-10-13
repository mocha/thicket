import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SessionUser } from "../lib/auth.js";

process.env.DATABASE_URL ??= "postgres://not-used-by-tests";
const { admin, normalizeSearch, parseLimit, parseCursor } = await import("./admin.js");
const { likeFor } = await import("../lib/like.js");
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

// ---- user list: search and paging --------------------------------------------
// The database is stubbed: these check what we ask it and how we shape what it returns.
const dialect = new PgDialect();
function userRow(id: number, createdAt: string) {
  return { id: String(id), handle: `user${id}`, displayName: null, isAdmin: false, profileVisibility: "public", createdAt: new Date(createdAt), cursorAt: createdAt.replace("Z", "000Z"), avatarUpdatedAt: null, lastSeenAt: null, following: 0, collections: 0, bookmarks: 0, invitedBy: id === 2 ? "admin" : null };
}
function stubUsers(t: TestContext, rows: ReturnType<typeof userRow>[], counts = { total: 50, matched: 3 }) {
  allowAdmin(t);
  const queries: { sql: string; params: unknown[] }[] = [];
  t.mock.method(db, "execute", async (query: any) => {
    const { sql, params } = dialect.sqlToQuery(query);
    queries.push({ sql, params });
    return { rows: queries.length === 1 ? rows : [counts] };
  });
  return queries;
}
const list = (qs = "") => app().request(`/api/admin/users${qs}`);

test("user list requires an admin", async (t) => {
  assert.equal((await app(null).request("/api/admin/users")).status, 401);
  t.mock.method(db, "select", () => ({ from: () => ({ where: async () => [{ isAdmin: false }] }) }));
  assert.equal((await list()).status, 403);
});

test("user list is newest first, one page at a time, with a cursor for the next page", async (t) => {
  const rows = [userRow(9, "2026-10-09T10:00:00.123Z"), userRow(8, "2026-10-08T10:00:00.000Z"), userRow(7, "2026-10-07T10:00:00.000Z")];
  const queries = stubUsers(t, rows, { total: 50, matched: 50 });
  const r = await list("?limit=2");
  assert.equal(r.status, 200);
  const body = await r.json() as any;
  assert.deepEqual(body.users.map((u: any) => u.id), [9, 8]);
  assert.equal(body.next, "2026-10-08T10:00:00.000000Z_8");
  assert.equal(body.total, 50);
  assert.equal(body.users[0].cursorAt, undefined);
  assert.match(queries[0].sql, /order by u\.created_at desc, u\.id desc/);
  assert.ok(queries[0].params.includes(3), "asks for limit + 1 rows");
});

test("user list returns no cursor on the last page, and defaults and clamps the page size", async (t) => {
  const queries = stubUsers(t, [userRow(2, "2026-10-02T00:00:00.000Z"), userRow(1, "2026-10-01T00:00:00.000Z")]);
  const body = await (await list()).json() as any;
  assert.equal(body.next, null);
  assert.equal(body.users[0].invitedBy, "admin");
  assert.ok(queries[0].params.includes(21));
  assert.equal(parseLimit(undefined), 20);
  assert.equal(parseLimit(""), 20);
  assert.equal(parseLimit("abc"), 20);
  assert.equal(parseLimit("0"), 1);
  assert.equal(parseLimit("-5"), 1);
  assert.equal(parseLimit("500"), 100);
  assert.equal(parseLimit("7"), 7);
});

test("the second page starts strictly after the cursor", async (t) => {
  const queries = stubUsers(t, [userRow(7, "2026-10-07T10:00:00.000Z")]);
  const r = await list("?before=2026-10-08T10:00:00.000000Z_8");
  assert.equal(r.status, 200);
  assert.match(queries[0].sql, /\(u\.created_at, u\.id\) < \(\$\d+::timestamptz, \$\d+\)/);
  assert.ok(queries[0].params.includes("2026-10-08T10:00:00.000000Z"));
  assert.ok(queries[0].params.includes(8));
});

test("a malformed cursor is a 400 with a clear message, before any query", async (t) => {
  allowAdmin(t);
  const execute = t.mock.method(db, "execute", () => { throw new Error("bad cursor reached the database"); });
  for (const before of ["nope", "8", "2026-10-08_8", "2026-10-08T10:00:00Z_x", "2026-13-45T99:00:00Z_8", "2026-10-08T10:00:00Z_8; drop table users"]) {
    const r = await list(`?before=${encodeURIComponent(before)}`);
    assert.equal(r.status, 400, before);
    assert.match(((await r.json()) as any).error, /not a valid cursor/);
  }
  assert.equal(execute.mock.callCount(), 0);
});

test("search matches handle or display name, ignoring case, with or without a leading @", async (t) => {
  for (const q of ["Ann", "  @ann  ", "@ANN"]) {
    const queries = stubUsers(t, [userRow(3, "2026-10-03T00:00:00.000Z")], { total: 50, matched: 1 });
    const body = await (await list(`?q=${encodeURIComponent(q)}`)).json() as any;
    assert.match(queries[0].sql, /u\.handle ilike \$\d+ escape '\\' or u\.display_name ilike \$\d+ escape '\\'/);
    assert.ok(queries[0].params.includes(`%${q.trim().replace(/^@/, "")}%`), q);
    assert.equal(body.matched, 1);
    t.mock.restoreAll();
  }
  assert.equal(normalizeSearch("  @Ann "), "Ann");
  assert.equal(normalizeSearch("@@x"), "@x");
  assert.equal(normalizeSearch("   "), "");
  assert.equal(normalizeSearch(undefined), "");
});

test("an empty search adds no filter", async (t) => {
  const queries = stubUsers(t, []);
  await list("?q=%20%40%20");
  assert.doesNotMatch(queries[0].sql, /ilike/);
});

test("search wildcards in user input match literally", async (t) => {
  assert.equal(likeFor("100%_done\\"), "%100\\%\\_done\\\\%");
  const queries = stubUsers(t, []);
  await list(`?q=${encodeURIComponent("a%b_c")}`);
  assert.ok(queries[0].params.includes("%a\\%b\\_c%"));
});

test("total counts every account while matched counts only the search", async (t) => {
  stubUsers(t, [userRow(3, "2026-10-03T00:00:00.000Z")], { total: 1234, matched: 5 });
  const body = await (await list("?q=ann")).json() as any;
  assert.equal(body.total, 1234);
  assert.equal(body.matched, 5);
});

test("cursor parsing accepts what the server hands out and nothing else", () => {
  assert.deepEqual(parseCursor("2026-10-08T10:00:00.123456Z_8"), { createdAt: "2026-10-08T10:00:00.123456Z", id: 8 });
  assert.equal(parseCursor("2026-10-08T10:00:00.1234567Z_8"), null);
  assert.equal(parseCursor(""), null);
});

test("starter packs setting requires a signed-in admin, to read and to change", async (t) => {
  const put = (a: Hono) => a.request("/api/admin/starter", { method: "PUT", headers: { "content-type": "application/json" }, body: '{"handle":"someone"}' });
  const execute = t.mock.method(db, "execute", () => { throw new Error("an unauthorized request reached the database"); });
  assert.equal((await app(null).request("/api/admin/starter")).status, 401);
  assert.equal((await put(app(null))).status, 401);
  t.mock.method(db, "select", () => ({ from: () => ({ where: async () => [{ isAdmin: false }] }) }));
  assert.equal((await app().request("/api/admin/starter")).status, 403);
  assert.equal((await put(app())).status, 403);
  assert.equal(execute.mock.callCount(), 0);
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
