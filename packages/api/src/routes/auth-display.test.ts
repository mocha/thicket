/**
 * Saved display settings (issue #186). The strict check is a plain function,
 * so it's tested directly; the routes are only tested for who may reach them,
 * which is decided before the database is asked, so this runs with none. Run
 * with `pnpm --filter @thicket/api test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";

process.env.DATABASE_URL ??= "postgres://not-used-by-tests";
const { auth } = await import("./auth.js");
const { tokenMay } = await import("../lib/token-access.js");
const { parseSavedDisplay } = await import("../lib/display.js");

const GOOD = {
  appearance: "dark", palette: "contrast", accent: "orange",
  fonts: { headings: { family: "serif", size: 2 }, reading: { family: "dyslexic", size: -1 }, app: { family: "sans", size: 0 } },
  reading: "inline", layout: "paged", fresh: true,
};
const without = (key: string) => Object.fromEntries(Object.entries(GOOD).filter(([k]) => k !== key));

test("a complete set of settings is kept exactly as sent", () => {
  assert.deepEqual(parseSavedDisplay(structuredClone(GOOD)), { ok: true, value: GOOD });
});

test("anything wrong is refused with the reason, never swapped for a default", () => {
  const cases: [unknown, RegExp][] = [
    [null, /object/],
    [[], /object/],
    [{ ...GOOD, palette: "fog" }, /palette/],
    [{ ...GOOD, appearance: "auto" }, /appearance/],
    [{ ...GOOD, fresh: "yes" }, /fresh/],
    [without("layout"), /layout/],
    [{ ...GOOD, extra: 1 }, /unknown setting "extra"/],
    [{ ...GOOD, fonts: { ...GOOD.fonts, app: { family: "comic", size: 0 } } }, /fonts\.app\.family/],
    [{ ...GOOD, fonts: { ...GOOD.fonts, app: { family: "sans", size: 13 } } }, /fonts\.app\.size/],
    [{ ...GOOD, fonts: { ...GOOD.fonts, app: { family: "sans", size: 1.5 } } }, /fonts\.app\.size/],
    [{ ...GOOD, fonts: { headings: GOOD.fonts.headings, reading: GOOD.fonts.reading } }, /fonts\.app is missing/],
    [{ ...GOOD, fonts: { ...GOOD.fonts, footer: GOOD.fonts.app } }, /unknown font role/],
  ];
  for (const [input, reason] of cases) {
    const r = parseSavedDisplay(input);
    assert.equal(r.ok, false, JSON.stringify(input));
    if (!r.ok) assert.match(r.error, reason);
  }
});

function app() {
  const a = new Hono();
  a.use("*", async (c, next) => { c.set("user", null); await next(); });
  a.route("/api/auth", auth);
  return a;
}

test("signed out, nobody can save settings or answer the offer", async () => {
  assert.equal((await app().request("/api/auth/me/display", { method: "PUT", body: JSON.stringify({ settings: GOOD }) })).status, 401);
  assert.equal((await app().request("/api/auth/me/display-offer", { method: "POST" })).status, 401);
});

test("no API token can save settings or answer the offer", () => {
  for (const kind of ["read", "full"] as const) {
    assert.equal(tokenMay(kind, "PUT", "/api/auth/me/display").ok, false, kind);
    assert.equal(tokenMay(kind, "POST", "/api/auth/me/display-offer").ok, false, kind);
  }
});
