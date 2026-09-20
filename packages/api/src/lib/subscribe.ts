import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import { FIRST_COLLECTION_NAME, FIRST_COLLECTION_SLUG, type SessionUser } from "./auth.js";
import { discover, type Discovery } from "../feeds/discover.js";
import { normalizeFeedUrl } from "../feeds/normalize.js";
import { storeItems, chooseInterval } from "../feeds/refresh.js";
import { backfillFeed } from "../feeds/backfill.js";
import { assertCanFollow } from "./entitlements.js";

/** Get-or-create a global feed row from a discovery result and store its first batch of items. */
export async function ensureFeedFromDiscovery(d: Extract<Discovery, { status: "feed" }>) {
  const [existing] = await db.select().from(schema.feeds).where(eq(schema.feeds.url, d.url));
  if (existing) return existing;
  const { newestAt } = { newestAt: d.parsed.items.reduce<Date | null>((m, i) => (i.publishedAt && (!m || i.publishedAt > m) ? i.publishedAt : m), null) };
  const interval = chooseInterval(newestAt);
  const [feed] = await db
    .insert(schema.feeds)
    .values({
      url: d.url,
      siteUrl: d.parsed.siteUrl,
      title: d.parsed.title,
      description: d.parsed.description,
      kind: d.parsed.kind,
      etag: d.etag,
      lastModified: d.lastModified,
      lastFetchedAt: new Date(),
      lastStatus: 200,
      lastItemAt: newestAt,
      fetchIntervalS: interval,
      nextFetchAt: new Date(Date.now() + interval * 1000),
    })
    .onConflictDoNothing()
    .returning();
  const row = feed ?? (await db.select().from(schema.feeds).where(eq(schema.feeds.url, d.url)))[0];
  await storeItems(row.id, d.parsed, { firstFetch: true });
  if (!existing) {
    // A brand-new feed, not a re-follow of one thicket already knows: worth trying for a deeper
    // history than its live document gave us. Never blocks the request that's adding it.
    // Always logged, not just on success: a quiet 429 here previously looked identical to
    // "nothing more existed," which it isn't. See feeds/backfill.ts.
    void backfillFeed(row.id)
      .then((r) => console.log(`[backfill] feed ${r.feedId}: ${r.reason}`))
      .catch((e) => console.error(`[backfill] feed ${row.id} failed:`, e));
  }
  return row;
}

/** Register a feed URL without fetching it (bulk seeding). The scheduler will pick it up. */
export async function ensureFeedLazy(url: string) {
  const normalized = normalizeFeedUrl(url);
  const [row] = await db.insert(schema.feeds).values({ url: normalized, nextFetchAt: new Date() }).onConflictDoNothing().returning();
  return row ?? (await db.select().from(schema.feeds).where(eq(schema.feeds.url, normalized)))[0];
}

/**
 * Where a bare "Follow" files a feed: the person's oldest collection, which for
 * a new account is the one they were given. Following has no unfiled state, so
 * this can never answer "nowhere" — if every collection has been deleted, the
 * first one comes back.
 */
export async function defaultCollectionFor(user: SessionUser): Promise<number> {
  if (user.defaultCollectionId !== null) return user.defaultCollectionId;
  const [existing] = await db
    .select({ id: schema.collections.id })
    .from(schema.collections)
    .where(and(eq(schema.collections.userId, user.id), isNotNull(schema.collections.parentId)))
    .orderBy(schema.collections.id)
    .limit(1);
  if (existing) return existing.id;
  const [made] = await db
    .insert(schema.collections)
    .values({ userId: user.id, parentId: user.rootCollectionId, name: FIRST_COLLECTION_NAME, slug: FIRST_COLLECTION_SLUG })
    .returning();
  return made.id;
}

/**
 * Put a feed in a collection. Every write path goes through here. The root row
 * is the tree's parent and nothing else: a feed filed there would be followed
 * but in no collection, which is the state this app no longer has.
 * Throws PlanLimitError when the owner's plan has no room for another feed.
 */
export async function addFeedToCollection(collectionId: number, feedId: number) {
  const [col] = await db.select({ userId: schema.collections.userId, parentId: schema.collections.parentId }).from(schema.collections).where(eq(schema.collections.id, collectionId));
  if (!col || col.parentId === null) return;
  // The owner's plan caps how many feeds they follow. Checked here because every
  // write path comes through here; throws PlanLimitError (lib/plans.ts).
  await assertCanFollow(col.userId, feedId);
  await db.insert(schema.collectionFeeds).values({ collectionId, feedId }).onConflictDoNothing();
}

export type SubscribeOutcome =
  | { status: "subscribed"; feed: typeof schema.feeds.$inferSelect; alreadyFollowed: boolean }
  | { status: "choose"; candidates: { url: string; title: string | null; kind: string | null }[] }
  | { status: "none"; pageUrl: string };

/** The one acquisition path: any URL in, a followed feed (or a choice) out. */
export async function subscribe(user: SessionUser, input: string, collectionId?: number): Promise<SubscribeOutcome> {
  const d = await discover(input);
  if (d.status === "candidates") return { status: "choose", candidates: d.candidates };
  if (d.status === "none") return { status: "none", pageUrl: d.pageUrl };
  const feed = await ensureFeedFromDiscovery(d);
  const target = collectionId ?? (await defaultCollectionFor(user));
  const [before] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.collectionFeeds).where(eq(schema.collectionFeeds.feedId, feed.id));
  await addFeedToCollection(target, feed.id);
  return { status: "subscribed", feed, alreadyFollowed: before.n > 0 };
}
