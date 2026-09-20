/**
 * The plan in force, and the limits table's shape. Pure functions only: no
 * database, no server. Run with `pnpm --filter @thicket/api test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PLANS, PLAN_LIMITS, PlanLimitError, effectivePlan, planThatAllows } from "./plans.js";

const now = new Date("2026-09-20T12:00:00Z");

test("instance source takes the instance default, whatever the plan column says", () => {
  assert.equal(effectivePlan({ plan: "advanced", planSource: "instance", planUntil: null, isAdmin: false }, "free", now), "free");
  assert.equal(effectivePlan({ plan: "free", planSource: "instance", planUntil: null, isAdmin: false }, "advanced", now), "advanced");
});

test("a comp holds until its date, then falls back to the instance default", () => {
  const comp = { plan: "basic" as const, planSource: "comp" as const, isAdmin: false };
  assert.equal(effectivePlan({ ...comp, planUntil: null }, "free", now), "basic");
  assert.equal(effectivePlan({ ...comp, planUntil: new Date("2027-01-01") }, "free", now), "basic");
  assert.equal(effectivePlan({ ...comp, planUntil: "2026-09-20T11:59:59Z" }, "free", now), "free");
  assert.equal(effectivePlan({ ...comp, planUntil: now }, "free", now), "free", "expiry is inclusive");
});

test("a subscription's plan stands on its own", () => {
  assert.equal(effectivePlan({ plan: "basic", planSource: "stripe", planUntil: null, isAdmin: false }, "free", now), "basic");
});

test("admins are the admin tier, above every plan, whatever was granted", () => {
  assert.equal(effectivePlan({ plan: "free", planSource: "instance", planUntil: null, isAdmin: true }, "free", now), "admin");
  assert.equal(effectivePlan({ plan: "basic", planSource: "comp", planUntil: "2020-01-01", isAdmin: true }, "free", now), "admin");
});

test("the admin tier checks nothing", () => {
  const a = PLAN_LIMITS.admin;
  assert.equal(a.feeds, null);
  assert.equal(a.collections, null);
  assert.equal(a.bookmarks, null);
  assert.ok(a.notes && a.nested);
  assert.equal(a.addFeedPerHour, Infinity);
  assert.equal(planThatAllows("feeds", "admin"), null, "nothing is offered above admin");
});

// The horizon (`days`) is deliberately not in here: Free has none because its
// per-feed cap already bounds the page, while Basic sees a year of everything.
test("plans only ever widen going up the ladder", () => {
  const ge = (a: number | null, b: number | null) => a === null || (b !== null && a >= b);
  for (let i = 1; i < PLANS.length; i++) {
    const lower = PLAN_LIMITS[PLANS[i - 1]], upper = PLAN_LIMITS[PLANS[i]];
    assert.ok(ge(upper.feeds, lower.feeds), `${PLANS[i]} feeds`);
    assert.ok(ge(upper.collections, lower.collections), `${PLANS[i]} collections`);
    assert.ok(ge(upper.bookmarks, lower.bookmarks), `${PLANS[i]} bookmarks`);
    assert.ok(upper.addFeedPerHour >= lower.addFeedPerHour, `${PLANS[i]} add-a-feed pace`);
    assert.ok(upper.notes || !lower.notes, `${PLANS[i]} notes`);
    assert.ok(upper.nested || !lower.nested, `${PLANS[i]} nesting`);
    for (const view of ["feedView", "collectionView"] as const) {
      assert.ok(ge(upper[view].perFeed, lower[view].perFeed), `${PLANS[i]} ${view} perFeed`);
      assert.ok(ge(upper[view].total, lower[view].total), `${PLANS[i]} ${view} total`);
    }
  }
});

test("advanced has no caps at all", () => {
  const a = PLAN_LIMITS.advanced;
  assert.equal(a.collections, null);
  assert.equal(a.bookmarks, null);
  assert.ok(a.notes && a.nested);
  assert.deepEqual(a.feedView, { perFeed: null, total: null, days: null });
});

test("the upsell names the smallest plan that lifts the limit", () => {
  assert.equal(planThatAllows("feeds", "free"), "basic");
  assert.equal(planThatAllows("notes", "free"), "basic");
  assert.equal(planThatAllows("nested", "free"), "advanced");
  assert.equal(planThatAllows("nested", "basic"), "advanced");
  assert.equal(planThatAllows("feeds", "advanced"), null);
});

test("a refusal carries what the web app needs", () => {
  const e = new PlanLimitError("feeds", "free", 20);
  assert.equal(e.body().code, "plan_limit");
  assert.deepEqual(e.body().limit, { kind: "feeds", plan: "free", max: 20, upgrade: "basic" });
  assert.match(e.message, /20 feeds/);
});
