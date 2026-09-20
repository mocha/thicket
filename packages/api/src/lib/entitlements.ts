/**
 * Entitlements: the plan logic of lib/plans.ts joined to the database. What
 * plan an account is on, how much of it is used, and the checks a route makes
 * before creating something. Everything pure lives in plans.ts so it can be
 * tested without a database; this module re-exports it, so routes import
 * from here alone.
 */
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { getSetting, visitorsLimited } from "./instance.js";
import { DEFAULT_PLAN } from "./config.js";
import { PlanLimitError, VISITOR_VIEW, effectivePlan, isPlan, limitsOf, type Plan, type PlanRow, type Tier, type ViewWindow } from "./plans.js";
export * from "./plans.js";

/**
 * The instance's default plan: the admin's setting, else the DEFAULT_PLAN
 * environment seed, else `advanced` (a self-hosted instance has no limits
 * unless someone asks for them). Read on every request, so it is cached for a
 * few seconds; setDefaultPlan() drops the cache.
 */
let cached: { plan: Plan; at: number } | null = null;
const CACHE_MS = 15_000;
export async function defaultPlan(): Promise<Plan> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.plan;
  const stored = await getSetting<string>("default_plan");
  const plan = isPlan(stored) ? stored : DEFAULT_PLAN;
  cached = { plan, at: Date.now() };
  return plan;
}
export function forgetDefaultPlan(): void {
  cached = null;
}

/** The plan of an account by id, for code paths that only have the id (imports, the follow helper). */
export async function planOf(userId: number): Promise<Tier> {
  const [row] = (await db.execute<PlanRow>(sql`
    select plan, plan_source as "planSource", plan_until as "planUntil", is_admin as "isAdmin" from users where id = ${userId}`)).rows;
  if (!row) return "free";
  return effectivePlan(row, await defaultPlan());
}

// ---- usage -----------------------------------------------------------------

export type Usage = { feeds: number; collections: number; bookmarks: number; notes: number };

export async function usageOf(userId: number): Promise<Usage> {
  const [row] = (await db.execute<Usage>(sql`
    select (select count(distinct cf.feed_id)::int from collection_feeds cf join collections col on col.id = cf.collection_id where col.user_id = ${userId}) as feeds,
           (select count(*)::int from collections where user_id = ${userId} and parent_id is not null) as collections,
           (select count(*)::int from bookmarks where user_id = ${userId}) as bookmarks,
           (select count(*)::int from notes where user_id = ${userId}) as notes`)).rows;
  return row;
}

/** Follow another feed? Throws when the plan's cap is reached and this feed is not already followed. */
export async function assertCanFollow(userId: number, feedId: number, plan?: Tier): Promise<void> {
  plan ??= await planOf(userId);
  const max = limitsOf(plan).feeds;
  if (max === null) return;
  const [row] = (await db.execute<{ n: number; already: boolean }>(sql`
    select (select count(distinct cf.feed_id)::int from collection_feeds cf join collections col on col.id = cf.collection_id where col.user_id = ${userId}) as n,
           exists(select 1 from collection_feeds cf join collections col on col.id = cf.collection_id where col.user_id = ${userId} and cf.feed_id = ${feedId}) as already`)).rows;
  if (row.already || row.n < max) return;
  throw new PlanLimitError("feeds", plan, max);
}

/** Make another collection? */
export async function assertCanCreateCollection(userId: number, plan?: Tier): Promise<void> {
  plan ??= await planOf(userId);
  const max = limitsOf(plan).collections;
  if (max === null) return;
  const [{ n }] = (await db.execute<{ n: number }>(sql`select count(*)::int as n from collections where user_id = ${userId} and parent_id is not null`)).rows;
  if (n < max) return;
  throw new PlanLimitError("collections", plan, max);
}

export function assertNested(plan: Tier): void {
  if (!limitsOf(plan).nested) throw new PlanLimitError("nested", plan, null);
}
export function assertNotes(plan: Tier): void {
  if (!limitsOf(plan).notes) throw new PlanLimitError("notes", plan, null);
}

// ---- what a page of posts may show ------------------------------------------

/**
 * The window for a page of posts: a feed's page or a collection's (and "all
 * my feeds", which is every collection at once). Signed out, the visitor
 * window, unless an admin lets visitors read everything.
 */
export async function viewFor(user: { plan: Tier } | null, kind: "feed" | "collection"): Promise<ViewWindow> {
  const key = kind === "feed" ? "feedView" : "collectionView";
  if (user) return limitsOf(user.plan)[key];
  return (await visitorsLimited()) ? VISITOR_VIEW[key] : { perFeed: null, total: null, days: null };
}
