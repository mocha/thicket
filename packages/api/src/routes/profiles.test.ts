/**
 * Who follows you is yours alone (issue #191): signed out is a 401, and
 * anyone else's list is a 404. Both are decided from the session before the
 * database is asked, so this runs with no database at all; if the route did
 * reach for one, the request would fail with a 500 instead. Run with
 * `pnpm --filter @thicket/api test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import type { SessionUser } from "../lib/auth.js";

// The router imports the database client, which wants an address at import time. It is never connected to here.
process.env.DATABASE_URL ??= "postgres://not-used-by-tests";
const { profiles } = await import("./profiles.js");

const ME: SessionUser = { id: 7, handle: "me", displayName: null, rootCollectionId: 1, defaultCollectionId: 2, trackActivity: false };

function app(user: SessionUser | null) {
  const a = new Hono();
  a.use("*", async (c, next) => { c.set("user", user); await next(); });
  a.route("/api/profiles", profiles);
  return a;
}

test("signed out, nobody's followers can be read", async () => {
  for (const handle of ["me", "someone"]) {
    const r = await app(null).request(`/api/profiles/${handle}/followers`);
    assert.equal(r.status, 401, handle);
  }
});

test("signed in, someone else's followers are not found", async () => {
  for (const handle of ["someone", "%40someone", "SOMEONE", "me2"]) {
    const r = await app(ME).request(`/api/profiles/${handle}/followers`);
    assert.equal(r.status, 404, handle);
    assert.deepEqual(await r.json(), { error: "not found" });
  }
});
