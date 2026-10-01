/**
 * What an API token looks like and what it may do (issue #140), and the two
 * rolling limits it is held to. Pure: no database, no server. Run with
 * `pnpm --filter @thicket/api test`.
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { bearerOf, hashToken, looksLikeToken, newToken, tokenMay } from "./token-access.js";
import { LIMITS, hitRolling } from "./ratelimit.js";

test("a new token says its kind up front and is different every time", () => {
  const ro = newToken("read"), rw = newToken("full");
  assert.match(ro, /^thk_ro_[A-Za-z0-9_-]{43}$/);
  assert.match(rw, /^thk_rw_[A-Za-z0-9_-]{43}$/);
  assert.notEqual(newToken("read"), ro);
  assert.ok(looksLikeToken(ro) && looksLikeToken(rw));
  assert.equal(hashToken(ro).length, 64);
});

test("only something shaped like a token is looked up", () => {
  for (const bad of ["", "thk_ro_", "thk_ro_short", "thk_xx_" + "a".repeat(43), "Bearer", "a".repeat(50), newToken("read") + "x"]) assert.equal(looksLikeToken(bad), false, bad);
});

test("the Authorization header is read as a Bearer token or not at all", () => {
  assert.equal(bearerOf("Bearer abc"), "abc");
  assert.equal(bearerOf("bearer   abc  "), "abc");
  assert.equal(bearerOf(undefined), null);
  assert.equal(bearerOf("Basic abc"), null);
  assert.equal(bearerOf("Bearer"), null);
});

test("a read-only token reads everything a token may reach and changes nothing", () => {
  for (const path of ["/api/river", "/api/bookmarks", "/api/feeds/12", "/api/collections/3/opml", "/api/search", "/api/auth/me", "/api/profiles/someone", "/api/users/someone/avatar"]) {
    assert.deepEqual(tokenMay("read", "GET", path), { ok: true }, path);
  }
  for (const [method, path] of [["POST", "/api/bookmarks"], ["DELETE", "/api/bookmarks/9"], ["PUT", "/api/notes/items/4"], ["POST", "/api/feeds"], ["PATCH", "/api/collections/3"], ["DELETE", "/api/feeds/12"]]) {
    const v = tokenMay("read", method, path);
    assert.equal(v.ok, false, `${method} ${path}`);
    assert.match(v.ok ? "" : v.error, /read-only token/);
  }
});

test("a read that is sent as a POST is still a read", () => {
  assert.deepEqual(tokenMay("read", "POST", "/api/marks/counts"), { ok: true });
});

test("a full access token reads and writes", () => {
  for (const [method, path] of [["GET", "/api/river"], ["POST", "/api/bookmarks"], ["DELETE", "/api/bookmarks/9"], ["PUT", "/api/notes/items/4"], ["POST", "/api/feeds"], ["DELETE", "/api/collections/3"]]) {
    assert.deepEqual(tokenMay("full", method, path), { ok: true }, `${method} ${path}`);
  }
});

test("no token of either kind reaches the account, the tokens, the admin pages, the import page or the usage log", () => {
  const never: [string, string][] = [
    ["GET", "/api/tokens"], ["POST", "/api/tokens/full"], ["DELETE", "/api/tokens/read"],
    ["GET", "/api/admin/users"], ["GET", "/api/admin/settings"], ["DELETE", "/api/admin/users/3"], ["PATCH", "/api/admin/settings"],
    ["PATCH", "/api/auth/me"], ["POST", "/api/auth/me/password"], ["PUT", "/api/auth/me/email"], ["POST", "/api/auth/me/email/resend"],
    ["POST", "/api/auth/login"], ["POST", "/api/auth/logout"], ["POST", "/api/auth/signup"], ["POST", "/api/auth/reset-password"], ["DELETE", "/api/auth/me"],
    ["POST", "/api/users/me/avatar"], ["DELETE", "/api/users/me/avatar"],
    ["POST", "/api/import/read"], ["POST", "/api/import/check"], ["POST", "/api/import/commit"],
    ["POST", "/api/events"],
  ];
  for (const kind of ["read", "full"] as const) {
    for (const [method, path] of never) {
      const v = tokenMay(kind, method, path);
      assert.equal(v.ok, false, `${kind} ${method} ${path}`);
      if (kind === "full") assert.match(v.ok ? "" : v.error, /API tokens can’t be used for/, `${method} ${path}`);
    }
  }
});

test("dressing a path up does not get it past the rules", () => {
  for (const path of ["/api/admin/", "/api//admin/users", "/api/ADMIN/users", "/api/%61dmin/users", "/api/tokens/", "/API/tokens"]) {
    assert.equal(tokenMay("full", "GET", path).ok, false, path);
  }
  assert.equal(tokenMay("full", "POST", "/api/auth/me/").ok, false);
  assert.equal(tokenMay("full", "GET", "/api/auth/me/password").ok, false, "only me itself is readable, not what is under it");
});

test("burst limit: ten in any ten seconds, and the wait is until the oldest ages out", () => {
  mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-01T09:00:00Z") });
  try {
    const limits = [LIMITS.tokenBurst, LIMITS.tokenHourly];
    assert.deepEqual([LIMITS.tokenBurst.limit, LIMITS.tokenBurst.windowMs], [10, 10_000]);
    for (let i = 0; i < 10; i++) { assert.equal(hitRolling("t:burst", limits).ok, true, `request ${i + 1}`); mock.timers.tick(500); }
    // Five seconds in, ten made. The first was at 0s, so room opens at 10s.
    const over = hitRolling("t:burst", limits);
    assert.equal(over.ok, false);
    assert.equal(over.broke, LIMITS.tokenBurst);
    assert.equal(over.retryAfterS, 5);
    mock.timers.tick(4_999);
    assert.equal(hitRolling("t:burst", limits).ok, false, "a refused request did not use up allowance, and it is still too soon");
    mock.timers.tick(1);
    assert.equal(hitRolling("t:burst", limits).ok, true, "rolling: one ages out, one fits");
    assert.equal(hitRolling("t:burst", limits).ok, false, "and only one");
  } finally {
    mock.timers.reset();
  }
});

test("hourly limit: 120 in any hour, however politely spaced", () => {
  mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-01T09:00:00Z") });
  try {
    const limits = [LIMITS.tokenBurst, LIMITS.tokenHourly];
    assert.deepEqual([LIMITS.tokenHourly.limit, LIMITS.tokenHourly.windowMs], [120, 3600_000]);
    // One every two seconds never trips the burst limit; the 121st trips the hourly one.
    for (let i = 0; i < 120; i++) { assert.equal(hitRolling("t:hour", limits).ok, true, `request ${i + 1}`); mock.timers.tick(2_000); }
    const over = hitRolling("t:hour", limits);
    assert.equal(over.ok, false);
    assert.equal(over.broke, LIMITS.tokenHourly);
    assert.equal(over.retryAfterS, 3600 - 240, "until the first request, four minutes ago, is an hour old");
    mock.timers.tick((3600 - 240) * 1000);
    assert.equal(hitRolling("t:hour", limits).ok, true);
  } finally {
    mock.timers.reset();
  }
});

test("each token is counted on its own", () => {
  const limits = [LIMITS.tokenBurst, LIMITS.tokenHourly];
  for (let i = 0; i < 10; i++) hitRolling("t:own:1", limits);
  assert.equal(hitRolling("t:own:1", limits).ok, false);
  assert.equal(hitRolling("t:own:2", limits).ok, true);
});
