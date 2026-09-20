/**
 * Plans and what each one may do. This is a core concept of thicket, with no
 * payment provider in it: an account has a plan, a plan has limits, the API
 * enforces them here the way it enforces the visitor cap. Where a plan comes
 * from is a separate question (see users.plan_source):
 *
 * - `instance`: the plan every account on this instance gets by default. A
 *   self-hosted instance leaves this at `advanced`, which is "no limits", and
 *   never sees any of this. The hosted instance sets it to `free`.
 * - `comp`: an admin granted this plan by hand, optionally until a date.
 * - `stripe`: a subscription keeps it current (lib/billing, when present).
 *
 * Admins are always on the top plan. Limits are enforced when something is
 * created, never by deleting what exists: an account that drops to a smaller
 * plan keeps everything and can add nothing past the cap. The one exception
 * is the Free bookmark cap, which rolls (the oldest goes when a new one is
 * saved past the cap) by design.
 *
 * The numbers are @deuley's pricing table of 2026-09-20 (notes repo,
 * docs/BILLING.md). Change them here and nowhere else.
 */

/** The plans an account can be granted or subscribe to, smallest first. */
export const PLANS = ["free", "basic", "advanced"] as const;
export type Plan = (typeof PLANS)[number];
/**
 * What an account is actually on. `admin` is above every plan and is never
 * granted or stored: it is what an admin resolves to, and it checks nothing.
 * It exists for running the instance, not as a kind of customer.
 */
export type Tier = Plan | "admin";
export const PLAN_SOURCES = ["instance", "comp", "stripe"] as const;
export type PlanSource = (typeof PLAN_SOURCES)[number];

export const isPlan = (v: unknown): v is Plan => typeof v === "string" && (PLANS as readonly string[]).includes(v);

export const PLAN_NAMES: Record<Tier, string> = { free: "Free", basic: "Basic", advanced: "Advanced", admin: "Admin" };

/** What a page of posts may show this reader. null = no cap. */
export type ViewWindow = {
  /** Newest N posts of any one feed. */
  perFeed: number | null;
  /** Newest N posts of a page in total; one page, nothing after it. */
  total: number | null;
  /** Only posts newer than this many days. */
  days: number | null;
};

export type Limits = {
  /** Distinct feeds followed across all collections. */
  feeds: number | null;
  /** Named collections (the hidden root does not count). */
  collections: number | null;
  /** Bookmarks kept. Past this, saving one deletes the oldest. */
  bookmarks: number | null;
  notes: boolean;
  /** Sub-collections: creating one, moving one under another, copying a collection that has them. */
  nested: boolean;
  /** Add-a-feed requests an hour: each one makes thicket fetch a URL somebody typed. */
  addFeedPerHour: number;
  /** A single feed's page. */
  feedView: ViewWindow;
  /** A collection's page, and "all my feeds". */
  collectionView: ViewWindow;
};

export const PLAN_LIMITS: Record<Tier, Limits> = {
  free: {
    feeds: 20, collections: 1, bookmarks: 50, notes: false, nested: false, addFeedPerHour: 20,
    feedView: { perFeed: 25, total: 25, days: null },
    collectionView: { perFeed: 25, total: 100, days: null },
  },
  basic: {
    feeds: 500, collections: 100, bookmarks: null, notes: true, nested: false, addFeedPerHour: 60,
    feedView: { perFeed: null, total: null, days: 365 },
    collectionView: { perFeed: null, total: null, days: 365 },
  },
  advanced: {
    feeds: 1500, collections: null, bookmarks: null, notes: true, nested: true, addFeedPerHour: 120,
    feedView: { perFeed: null, total: null, days: null },
    collectionView: { perFeed: null, total: null, days: null },
  },
  admin: {
    feeds: null, collections: null, bookmarks: null, notes: true, nested: true, addFeedPerHour: Infinity,
    feedView: { perFeed: null, total: null, days: null },
    collectionView: { perFeed: null, total: null, days: null },
  },
};

/** Someone without an account: a taste of a feed or a collection, one page each. */
export const VISITOR_VIEW: { feedView: ViewWindow; collectionView: ViewWindow } = {
  feedView: { perFeed: 10, total: 10, days: null },
  collectionView: { perFeed: 10, total: 100, days: null },
};

export const limitsOf = (tier: Tier): Limits => PLAN_LIMITS[tier];

/** The smallest plan that lifts a limit, for the upsell. */
export function planThatAllows(kind: LimitKind, over: Tier): Plan | null {
  if (over === "admin") return null;
  for (const p of PLANS) {
    if (PLANS.indexOf(p) <= PLANS.indexOf(over)) continue;
    const l = PLAN_LIMITS[p];
    if (kind === "notes" ? l.notes : kind === "nested" ? l.nested : true) return p;
  }
  return null;
}

// ---- which plan is in force ------------------------------------------------

export type PlanRow = { plan: Plan; planSource: PlanSource; planUntil: Date | string | null; isAdmin: boolean };

/**
 * The plan an account is actually on right now. Pure, so it can be tested
 * without a database: the instance default is passed in.
 */
export function effectivePlan(u: PlanRow, instanceDefault: Plan, now = new Date()): Tier {
  if (u.isAdmin) return "admin";
  if (u.planSource === "instance") return instanceDefault;
  if (u.planUntil && new Date(u.planUntil).getTime() <= now.getTime()) return instanceDefault;
  return u.plan;
}

// ---- refusals --------------------------------------------------------------

export type LimitKind = "feeds" | "collections" | "notes" | "nested";

/**
 * Thrown where a plan says no. Routes turn it into a 403 with `code:
 * "plan_limit"` so the web app can offer the way past it, the way
 * `cappedAt` does for visitors.
 */
export class PlanLimitError extends Error {
  constructor(public kind: LimitKind, public plan: Tier, public max: number | null) {
    super(limitMessage(kind, plan, max));
    this.name = "PlanLimitError";
  }
  body() {
    return { error: this.message, code: "plan_limit" as const, limit: { kind: this.kind, plan: this.plan, max: this.max, upgrade: planThatAllows(this.kind, this.plan) } };
  }
}

function limitMessage(kind: LimitKind, plan: Tier, max: number | null): string {
  const name = PLAN_NAMES[plan];
  const next = planThatAllows(kind, plan);
  const more = next ? ` ${PLAN_NAMES[next]} accounts can.` : "";
  switch (kind) {
    case "feeds": return `${name} accounts follow up to ${max} feeds.${next ? ` ${PLAN_NAMES[next]} accounts follow more.` : ""}`;
    case "collections": return max === 1 ? `${name} accounts have one collection.${next ? ` ${PLAN_NAMES[next]} accounts have more.` : ""}` : `${name} accounts have up to ${max} collections.${next ? ` ${PLAN_NAMES[next]} accounts have more.` : ""}`;
    case "notes": return `${name} accounts can’t write notes.${more}`;
    case "nested": return `${name} accounts can’t nest collections inside one another.${more}`;
  }
}

