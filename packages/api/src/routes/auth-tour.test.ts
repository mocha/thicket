/**
 * The setup tour shows once per account (issue #172): the web app records
 * that you've seen it with POST /api/auth/me/tour. Only you can record it for
 * yourself, so signed out is a 401, decided from the session before the
 * database is asked; this runs with no database at all, and if the route did
 * reach for one first, the request would fail with a 500 instead. No API
 * token may reach it either: it's the web app's own business. Run with
 * `pnpm --filter @thicket/api test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";

// The router imports the database client, which wants an address at import time. It is never connected to here.
process.env.DATABASE_URL ??= "postgres://not-used-by-tests";
const { auth } = await import("./auth.js");
const { tokenMay } = await import("../lib/token-access.js");

function app() {
  const a = new Hono();
  a.use("*", async (c, next) => { c.set("user", null); await next(); });
  a.route("/api/auth", auth);
  return a;
}

test("signed out, nobody can record that the tour was seen", async () => {
  const r = await app().request("/api/auth/me/tour", { method: "POST" });
  assert.equal(r.status, 401);
});

test("no API token can record that the tour was seen", () => {
  for (const kind of ["read", "full"] as const) assert.equal(tokenMay(kind, "POST", "/api/auth/me/tour").ok, false, kind);
});
