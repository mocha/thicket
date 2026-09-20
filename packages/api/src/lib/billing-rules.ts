/**
 * The pure part of billing: what a subscription in a given state means for
 * the account. No Stripe client, no database, so it can be tested on its own.
 * lib/billing.ts applies these.
 */
import type { Plan } from "./plans.js";

/** The lookup key of the one price sold today, and the plan it buys. Created by scripts/stripe-setup.ts. */
export const PRICES: Record<string, Plan> = { "thicket-basic-annual": "basic" };
export const BASIC_LOOKUP_KEY = "thicket-basic-annual";
export const TRIAL_DAYS = 14;

/**
 * How long past the period end the plan stays in force without Stripe saying
 * anything. A renewal that Stripe is still retrying (past_due) keeps the plan;
 * a webhook that never arrives cannot keep it forever.
 */
export const GRACE_DAYS = 7;

export type SubscriptionFacts = {
  status: string;
  /** Stripe's lookup key for the price on the subscription. */
  lookupKey: string | null;
  /** End of the paid (or trial) period, as Stripe reports it. */
  currentPeriodEnd: Date | null;
};

export type Entitlement = { plan: Plan; until: Date } | null;

/**
 * The plan a subscription grants right now, and until when. Null means the
 * subscription grants nothing and the account returns to the instance
 * default. `trialing`, `active` and `past_due` all count: past_due is Stripe
 * retrying a card, and the person keeps reading until the retries give up
 * (which Stripe then reports as canceled or unpaid).
 */
export function entitlementFor(s: SubscriptionFacts): Entitlement {
  const plan = s.lookupKey ? PRICES[s.lookupKey] : undefined;
  if (!plan) return null;
  if (!["trialing", "active", "past_due"].includes(s.status)) return null;
  const end = s.currentPeriodEnd ?? new Date();
  return { plan, until: new Date(end.getTime() + GRACE_DAYS * 86400_000) };
}

/** A person gets one trial. A second subscription starts paid. */
export function trialDaysFor(hadSubscriptionBefore: boolean): number | undefined {
  return hadSubscriptionBefore ? undefined : TRIAL_DAYS;
}
