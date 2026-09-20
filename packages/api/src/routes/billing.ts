/**
 * Billing routes. GET /api/billing is public (is billing on, what does it
 * cost, what does each plan allow) so the pricing page can render; the rest
 * is the signed-in account's own subscription, and the webhook Stripe calls.
 *
 * The webhook reads the raw body: signature verification is over the bytes
 * Stripe sent, so nothing may parse or re-serialise them first. It answers
 * 2xx quickly and does its work inline, which at this size is quick; the
 * upgrade path is a queue, not a different route.
 */
import { Hono } from "hono";
import { currentUser } from "../lib/user.js";
import { PLAN_LIMITS } from "../lib/plans.js";
import { BILLING_ENABLED, applyEvent, basicPrice, completeCheckout, createCheckout, createPortal, summaryFor, verifyEvent } from "../lib/billing.js";
import { TRIAL_DAYS } from "../lib/billing-rules.js";
import { db, schema } from "../db/client.js";
import { eq } from "drizzle-orm";

export const billing = new Hono();

billing.get("/", async (c) => {
  const user = c.get("user");
  const price = await basicPrice().catch((err) => { console.error("[billing] price lookup failed:", err); return null; });
  return c.json({
    enabled: BILLING_ENABLED && !!price,
    price,
    trialDays: TRIAL_DAYS,
    plans: { free: PLAN_LIMITS.free, basic: PLAN_LIMITS.basic },
    subscription: user ? await summaryFor(user.id) : null,
  });
});

/** Where the return path may point: a page of this app, never elsewhere. */
const safeReturn = (v: unknown) => (typeof v === "string" && /^\/[a-z0-9/_-]*$/i.test(v) ? v : "/settings");

billing.post("/checkout", async (c) => {
  const user = currentUser(c);
  if (!BILLING_ENABLED) return c.json({ error: "Billing is not enabled on this instance." }, 404);
  const body = await c.req.json<{ returnTo?: string }>().catch(() => ({} as { returnTo?: string }));
  const [u] = await db.select({ email: schema.users.email }).from(schema.users).where(eq(schema.users.id, user.id));
  const url = await createCheckout({ id: user.id, handle: user.handle, email: u?.email }, safeReturn(body.returnTo));
  return c.json({ url });
});

billing.post("/portal", async (c) => {
  const user = currentUser(c);
  if (!BILLING_ENABLED) return c.json({ error: "Billing is not enabled on this instance." }, 404);
  const body = await c.req.json<{ returnTo?: string }>().catch(() => ({} as { returnTo?: string }));
  const url = await createPortal(user.id, safeReturn(body.returnTo));
  return c.json({ url });
});

/** Back from Checkout: apply the result now, so the page does not depend on the webhook having landed. */
billing.post("/checkout/complete", async (c) => {
  const user = currentUser(c);
  if (!BILLING_ENABLED) return c.json({ error: "Billing is not enabled on this instance." }, 404);
  const body = await c.req.json<{ sessionId?: string }>().catch(() => ({} as { sessionId?: string }));
  if (!body.sessionId) return c.json({ error: "sessionId is required" }, 400);
  const ent = await completeCheckout(user.id, body.sessionId);
  return c.json({ plan: ent?.plan ?? null, until: ent?.until.toISOString() ?? null, subscription: await summaryFor(user.id) });
});

billing.post("/webhook", async (c) => {
  if (!BILLING_ENABLED) return c.json({ error: "not enabled" }, 404);
  const signature = c.req.header("stripe-signature");
  if (!signature) return c.json({ error: "missing signature" }, 400);
  let event;
  try {
    event = verifyEvent(await c.req.text(), signature);
  } catch (err) {
    console.warn(`[billing] webhook rejected: ${err instanceof Error ? err.message : err}`);
    return c.json({ error: "bad signature" }, 400);
  }
  try {
    const outcome = await applyEvent(event);
    if (outcome === "applied") console.log(`[billing] ${event.type} ${event.id}`);
    return c.json({ received: true, outcome });
  } catch (err) {
    // A 5xx makes Stripe retry, which is what we want when our side failed.
    console.error(`[billing] ${event.type} ${event.id} failed:`, err);
    return c.json({ error: "handling failed" }, 500);
  }
});
