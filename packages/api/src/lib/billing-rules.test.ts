import { test } from "node:test";
import assert from "node:assert/strict";
import { GRACE_DAYS, entitlementFor, trialDaysFor } from "./billing-rules.js";

const end = new Date("2027-09-20T00:00:00Z");
const basic = (status: string) => entitlementFor({ status, lookupKey: "thicket-basic-annual", currentPeriodEnd: end });

test("trialing, active and past_due grant Basic until the period end plus grace", () => {
  for (const s of ["trialing", "active", "past_due"]) {
    const e = basic(s);
    assert.ok(e, s);
    assert.equal(e.plan, "basic");
    assert.equal(e.until.getTime(), end.getTime() + GRACE_DAYS * 86400_000);
  }
});

test("ended, unpaid, incomplete and paused subscriptions grant nothing", () => {
  for (const s of ["canceled", "unpaid", "incomplete", "incomplete_expired", "paused"]) assert.equal(basic(s), null, s);
});

test("an unknown price grants nothing, whatever its status", () => {
  assert.equal(entitlementFor({ status: "active", lookupKey: "something-else", currentPeriodEnd: end }), null);
  assert.equal(entitlementFor({ status: "active", lookupKey: null, currentPeriodEnd: end }), null);
});

test("one trial per person", () => {
  assert.equal(trialDaysFor(false), 14);
  assert.equal(trialDaysFor(true), undefined);
});
