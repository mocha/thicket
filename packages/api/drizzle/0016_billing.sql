-- Billing (lib/billing.ts). Stripe is the source of truth for money; these
-- two tables are the cache of what matters to the product and the ledger of
-- what Stripe has told us.
--
-- subscriptions: one row per account that has ever reached Checkout, keyed by
-- the account. The Stripe customer is created before Checkout, so a row can
-- exist with no subscription yet. Whatever the row says, the plan in force is
-- users.plan / plan_source / plan_until, which lib/billing.ts keeps current
-- from webhooks and re-syncs from Stripe on demand.
create table subscriptions (
  user_id bigint primary key references users(id) on delete cascade,
  stripe_customer_id text not null unique,
  stripe_subscription_id text unique,
  status text,
  price_lookup_key text,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  trial_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- billing_events: every webhook event id we have seen, so a redelivery is a
-- no-op. `error` keeps the reason when handling failed; Stripe retries.
create table billing_events (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text
);
