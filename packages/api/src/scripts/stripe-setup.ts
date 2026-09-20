/**
 * Set up a Stripe account for thicket, idempotently: the product and its
 * price (found again by lookup key), the Customer Portal configuration, and
 * the webhook endpoint when PUBLIC_URL is a public https address. Run once
 * against the sandbox and once against the live account:
 *
 *   pnpm --filter @thicket/api stripe:setup
 *
 * Prints the webhook signing secret when it creates the endpoint; put that
 * in the environment as STRIPE_WEBHOOK_SECRET. Never prints the API key.
 */
import Stripe from "stripe";
import { PUBLIC_URL, STRIPE_SECRET_KEY } from "../lib/config.js";
import { BASIC_LOOKUP_KEY } from "../lib/billing-rules.js";
import { WEBHOOK_EVENTS } from "../lib/billing.js";

if (!STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY is not set");
const stripe = new Stripe(STRIPE_SECRET_KEY);
const live = STRIPE_SECRET_KEY.includes("_live_");
console.log(`Stripe ${live ? "LIVE" : "sandbox"} account, public URL ${PUBLIC_URL}`);

// Product and price. The lookup key is what the app searches for; the price
// is the decision of 2026-09-20: $30 a year, annual only.
let price = (await stripe.prices.list({ lookup_keys: [BASIC_LOOKUP_KEY], active: true, limit: 1 })).data[0];
if (price) {
  console.log(`price ${price.id} exists: ${price.unit_amount} ${price.currency} / ${price.recurring?.interval}`);
} else {
  const products = await stripe.products.search({ query: "name:'thicket'" });
  const product = products.data[0] ?? (await stripe.products.create({ name: "thicket", description: "A year of thicket, hosted: follow up to 500 feeds, 100 collections, notes, and a year of posts." }));
  price = await stripe.prices.create({ product: product.id, currency: "usd", unit_amount: 3000, recurring: { interval: "year" }, lookup_key: BASIC_LOOKUP_KEY, transfer_lookup_key: true, nickname: "Basic, yearly" });
  console.log(`created product ${product.id} and price ${price.id} (${BASIC_LOOKUP_KEY})`);
}

// Customer Portal: card changes, invoices, cancel at period end. No plan
// switching, since there is one plan.
const configs = await stripe.billingPortal.configurations.list({ limit: 10 });
const mine = configs.data.find((c) => c.metadata?.thicket === "1");
const portalParams: Stripe.BillingPortal.ConfigurationCreateParams = {
  business_profile: { headline: "thicket", privacy_policy_url: `${PUBLIC_URL}/privacy`, terms_of_service_url: `${PUBLIC_URL}/terms` },
  features: {
    customer_update: { enabled: true, allowed_updates: ["email", "address"] },
    invoice_history: { enabled: true },
    payment_method_update: { enabled: true },
    subscription_cancel: { enabled: true, mode: "at_period_end", cancellation_reason: { enabled: true, options: ["too_expensive", "missing_features", "switched_service", "unused", "other"] } },
    subscription_update: { enabled: false },
  },
  default_return_url: `${PUBLIC_URL}/settings`,
  metadata: { thicket: "1" },
};
if (mine) {
  await stripe.billingPortal.configurations.update(mine.id, portalParams);
  console.log(`portal configuration ${mine.id} updated`);
} else {
  const made = await stripe.billingPortal.configurations.create(portalParams);
  console.log(`portal configuration ${made.id} created (the app selects it by its metadata)`);
}

// Webhook endpoint. Needs a public https address; in development the Stripe
// CLI forwards events instead (stripe listen --forward-to localhost:3000/api/billing/webhook).
const url = `${PUBLIC_URL}/api/billing/webhook`;
if (!PUBLIC_URL.startsWith("https://")) {
  console.log(`PUBLIC_URL is not https; no webhook endpoint registered. For development run:\n  stripe listen --forward-to localhost:3000/api/billing/webhook`);
} else {
  const endpoints = await stripe.webhookEndpoints.list({ limit: 20 });
  const existing = endpoints.data.find((e) => e.url === url);
  if (existing) {
    await stripe.webhookEndpoints.update(existing.id, { enabled_events: [...WEBHOOK_EVENTS] });
    console.log(`webhook endpoint ${existing.id} for ${url} exists (secret shown only at creation; roll it in the dashboard if lost)`);
  } else {
    const made = await stripe.webhookEndpoints.create({ url, enabled_events: [...WEBHOOK_EVENTS], description: "thicket" });
    console.log(`webhook endpoint ${made.id} created for ${url}\n\nSTRIPE_WEBHOOK_SECRET=${made.secret}\n\nPut that in the environment and redeploy.`);
  }
}
