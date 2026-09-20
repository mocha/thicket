/**
 * Billing: the Stripe adapter. Inert unless STRIPE_SECRET_KEY is set, which
 * is every self-hosted instance. The hosted instance sells one plan (Basic,
 * a year at a time) through Stripe Checkout with a card-first 14-day trial,
 * lets people manage it in Stripe's Customer Portal, and learns what
 * happened from webhooks.
 *
 * Stripe is the source of truth for money. Every event reduces to the same
 * step: re-read the subscription from Stripe and write what it means for the
 * account (lib/billing-rules.ts) into users.plan / plan_source / plan_until,
 * so a redelivered, reordered or missed event can never leave the plan
 * wrong for long. Event ids are recorded in billing_events so a redelivery
 * is a no-op.
 *
 * Nothing here is imported by the rest of the app except through
 * routes/billing.ts; the plan model (lib/plans.ts) knows nothing of Stripe.
 */
import Stripe from "stripe";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import { PUBLIC_URL, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, BILLING_ENABLED } from "./config.js";
import { BASIC_LOOKUP_KEY, entitlementFor, trialDaysFor, type Entitlement } from "./billing-rules.js";

export { BILLING_ENABLED };

let client: Stripe | null = null;
/** The Stripe client, or a clear error when billing is off. */
export function stripe(): Stripe {
  if (!STRIPE_SECRET_KEY) throw new Error("billing is not enabled on this instance");
  return (client ??= new Stripe(STRIPE_SECRET_KEY, { appInfo: { name: "thicket", url: PUBLIC_URL } }));
}

// ---- the price ---------------------------------------------------------------

export type PriceInfo = { id: string; lookupKey: string; amount: number; currency: string; interval: string };
let priceCache: { at: number; price: PriceInfo | null } | null = null;

/** The one price sold, found by lookup key so sandbox and live need no configuration beyond the secrets. Cached for an hour. */
export async function basicPrice(): Promise<PriceInfo | null> {
  if (!BILLING_ENABLED) return null;
  if (priceCache && Date.now() - priceCache.at < 3600_000) return priceCache.price;
  const list = await stripe().prices.list({ lookup_keys: [BASIC_LOOKUP_KEY], active: true, limit: 1 });
  const p = list.data[0];
  const price = p ? { id: p.id, lookupKey: p.lookup_key ?? BASIC_LOOKUP_KEY, amount: p.unit_amount ?? 0, currency: p.currency, interval: p.recurring?.interval ?? "year" } : null;
  priceCache = { at: Date.now(), price };
  return price;
}

// ---- customers and checkout ----------------------------------------------------

async function subscriptionRow(userId: number) {
  const [row] = await db.select().from(schema.subscriptions).where(eq(schema.subscriptions.userId, userId));
  return row ?? null;
}

/** The account's Stripe customer, made on first use and remembered. */
export async function ensureCustomer(user: { id: number; handle: string; email?: string | null }): Promise<string> {
  const row = await subscriptionRow(user.id);
  if (row) return row.stripeCustomerId;
  const customer = await stripe().customers.create({ name: `@${user.handle}`, email: user.email ?? undefined, metadata: { thicket_user_id: String(user.id), thicket_handle: user.handle } });
  await db.insert(schema.subscriptions).values({ userId: user.id, stripeCustomerId: customer.id }).onConflictDoNothing();
  return (await subscriptionRow(user.id))?.stripeCustomerId ?? customer.id;
}

/**
 * A Checkout session for Basic: card up front, then the trial, then the
 * charge. One trial per person: an account that has had a subscription
 * before starts paid. The billing address is collected from day one so tax
 * can be handled later without asking again.
 */
export async function createCheckout(user: { id: number; handle: string; email?: string | null }, returnTo = "/settings"): Promise<string> {
  const price = await basicPrice();
  if (!price) throw new Error("the Basic price is not set up in Stripe yet (pnpm stripe:setup)");
  const customer = await ensureCustomer(user);
  const before = await subscriptionRow(user.id);
  const trialDays = trialDaysFor(!!before?.stripeSubscriptionId);
  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer,
    customer_update: { address: "auto", name: "auto" },
    line_items: [{ price: price.id, quantity: 1 }],
    payment_method_collection: "always",
    billing_address_collection: "required",
    allow_promotion_codes: true,
    client_reference_id: String(user.id),
    subscription_data: {
      metadata: { thicket_user_id: String(user.id) },
      ...(trialDays ? { trial_period_days: trialDays, trial_settings: { end_behavior: { missing_payment_method: "cancel" } } } : {}),
    },
    success_url: `${PUBLIC_URL}${returnTo}?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${PUBLIC_URL}${returnTo}?checkout=cancelled`,
  });
  if (!session.url) throw new Error("Stripe returned no Checkout URL");
  return session.url;
}

let portalConfig: { at: number; id: string | null } | null = null;
/** The portal configuration scripts/stripe-setup.ts made, found by its metadata. Cached for an hour; absent = Stripe's default. */
async function portalConfigId(): Promise<string | null> {
  if (portalConfig && Date.now() - portalConfig.at < 3600_000) return portalConfig.id;
  const list = await stripe().billingPortal.configurations.list({ limit: 20 });
  const id = list.data.find((c) => c.metadata?.thicket === "1")?.id ?? null;
  portalConfig = { at: Date.now(), id };
  return id;
}

/** Stripe's hosted portal: card changes, invoices, cancelling. */
export async function createPortal(userId: number, returnTo = "/settings"): Promise<string> {
  const row = await subscriptionRow(userId);
  if (!row) throw new Error("no billing account yet");
  const configuration = await portalConfigId();
  const session = await stripe().billingPortal.sessions.create({ customer: row.stripeCustomerId, return_url: `${PUBLIC_URL}${returnTo}`, ...(configuration ? { configuration } : {}) });
  return session.url;
}

// ---- keeping the account current -----------------------------------------------

const asDate = (unix: number | null | undefined) => (unix ? new Date(unix * 1000) : null);

/** What the product needs from a subscription object, whichever API version shaped it. */
function facts(sub: Stripe.Subscription) {
  const item = sub.items?.data?.[0];
  const periodEnd = (item as { current_period_end?: number } | undefined)?.current_period_end ?? (sub as unknown as { current_period_end?: number }).current_period_end ?? null;
  return {
    status: sub.status,
    lookupKey: item?.price?.lookup_key ?? null,
    currentPeriodEnd: asDate(periodEnd),
    cancelAtPeriodEnd: !!sub.cancel_at_period_end || !!sub.cancel_at,
    trialEnd: asDate(sub.trial_end),
    customerId: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
  };
}

/** Whose subscription this is: the row that knows the customer, else the metadata Checkout wrote. */
async function userIdFor(sub: Stripe.Subscription): Promise<number | null> {
  const f = facts(sub);
  const [row] = await db.select({ userId: schema.subscriptions.userId }).from(schema.subscriptions).where(eq(schema.subscriptions.stripeCustomerId, f.customerId));
  if (row) return row.userId;
  const fromMeta = Number(sub.metadata?.thicket_user_id);
  return Number.isFinite(fromMeta) && fromMeta > 0 ? fromMeta : null;
}

/**
 * Write what a subscription means for its account: the cache row, and the
 * plan in force. Idempotent; called for every event and on demand.
 */
export async function syncSubscription(sub: Stripe.Subscription, email?: string | null): Promise<Entitlement> {
  const userId = await userIdFor(sub);
  if (userId === null) {
    console.warn(`[billing] subscription ${sub.id} belongs to no account here; ignored`);
    return null;
  }
  const f = facts(sub);
  await db.insert(schema.subscriptions)
    .values({ userId, stripeCustomerId: f.customerId, stripeSubscriptionId: sub.id, status: f.status, priceLookupKey: f.lookupKey, currentPeriodEnd: f.currentPeriodEnd, cancelAtPeriodEnd: f.cancelAtPeriodEnd, trialEnd: f.trialEnd, updatedAt: new Date() })
    .onConflictDoUpdate({ target: schema.subscriptions.userId, set: { stripeCustomerId: f.customerId, stripeSubscriptionId: sub.id, status: f.status, priceLookupKey: f.lookupKey, currentPeriodEnd: f.currentPeriodEnd, cancelAtPeriodEnd: f.cancelAtPeriodEnd, trialEnd: f.trialEnd, updatedAt: new Date() } });
  const ent = entitlementFor(f);
  if (ent) {
    await db.update(schema.users).set({ plan: ent.plan, planSource: "stripe", planUntil: ent.until, ...(email ? { email } : {}) }).where(eq(schema.users.id, userId));
  } else {
    // The subscription grants nothing now. Only a plan Stripe gave is taken back; an admin's grant stands.
    await db.execute(sql`update users set plan = 'free', plan_source = 'instance', plan_until = null where id = ${userId} and plan_source = 'stripe'`);
  }
  return ent;
}

/** Re-read a subscription from Stripe and apply it. The one step every event reduces to. */
export async function syncSubscriptionById(id: string, email?: string | null): Promise<Entitlement> {
  const sub = await stripe().subscriptions.retrieve(id);
  return syncSubscription(sub, email);
}

/** After Checkout returns: apply the session's subscription now rather than waiting for the webhook. */
export async function completeCheckout(userId: number, sessionId: string): Promise<Entitlement> {
  const session = await stripe().checkout.sessions.retrieve(sessionId);
  if (String(session.client_reference_id) !== String(userId)) throw new Error("that Checkout session is not yours");
  const subId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
  if (!subId) return null;
  return syncSubscriptionById(subId, session.customer_details?.email ?? null);
}

// ---- webhooks --------------------------------------------------------------------

export const WEBHOOK_EVENTS = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
] as const;

/** Verify a webhook delivery. Throws on a bad signature. */
export function verifyEvent(rawBody: string, signature: string): Stripe.Event {
  if (!STRIPE_WEBHOOK_SECRET) throw new Error("STRIPE_WEBHOOK_SECRET is not set");
  return stripe().webhooks.constructEvent(rawBody, signature, STRIPE_WEBHOOK_SECRET);
}

/** The subscription an event is about, whatever its type. */
function subscriptionIdOf(event: Stripe.Event): { id: string | null; email?: string | null } {
  const o = event.data.object as unknown as Record<string, unknown>;
  switch (event.type) {
    case "checkout.session.completed": {
      const s = o as unknown as Stripe.Checkout.Session;
      return { id: typeof s.subscription === "string" ? s.subscription : s.subscription?.id ?? null, email: s.customer_details?.email ?? null };
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      return { id: (o as unknown as Stripe.Subscription).id };
    case "invoice.paid":
    case "invoice.payment_failed": {
      const inv = o as unknown as Stripe.Invoice & { subscription?: string | { id: string } };
      const viaParent = inv.parent?.subscription_details?.subscription;
      const id = typeof viaParent === "string" ? viaParent : viaParent?.id ?? (typeof inv.subscription === "string" ? inv.subscription : inv.subscription?.id) ?? null;
      return { id };
    }
    default:
      return { id: null };
  }
}

/**
 * Apply one event, once. A duplicate delivery (same event id) is skipped.
 * Handling is "re-read the subscription and sync", so the event's own
 * payload is only used to find the subscription; its contents may be stale
 * by the time it arrives, and Stripe does not promise order.
 */
export async function applyEvent(event: Stripe.Event): Promise<"applied" | "duplicate" | "ignored"> {
  const seen = await db.insert(schema.billingEvents).values({ id: event.id, type: event.type }).onConflictDoNothing().returning({ id: schema.billingEvents.id });
  if (!seen.length) return "duplicate";
  try {
    const { id, email } = subscriptionIdOf(event);
    if (!id) {
      await db.update(schema.billingEvents).set({ processedAt: new Date() }).where(eq(schema.billingEvents.id, event.id));
      return "ignored";
    }
    await syncSubscriptionById(id, email);
    await db.update(schema.billingEvents).set({ processedAt: new Date() }).where(eq(schema.billingEvents.id, event.id));
    return "applied";
  } catch (err) {
    // Recorded, then forgotten, so Stripe's retry is handled fresh rather than skipped as a duplicate.
    await db.delete(schema.billingEvents).where(eq(schema.billingEvents.id, event.id));
    throw err;
  }
}

/** What Settings shows: the account's subscription, if any. */
export async function summaryFor(userId: number) {
  const row = await subscriptionRow(userId);
  if (!row?.stripeSubscriptionId) return null;
  return {
    status: row.status,
    currentPeriodEnd: row.currentPeriodEnd?.toISOString() ?? null,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    trialEnd: row.trialEnd?.toISOString() ?? null,
  };
}
