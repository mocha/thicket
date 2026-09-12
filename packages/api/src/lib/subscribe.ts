import { eq, sql } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import { discover, type Discovery } from "../feeds/discover.js";
import { normalizeFeedUrl } from "../feeds/normalize.js";
import { storeItems, chooseInterval } from "../feeds/refresh.js";
import { backfillFeed } from "../feeds/backfill.js";

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
 * Put a feed in a collection. Unsorted (the root) means "followed but not
 * filed", so it is exclusive with the named collections: filing into a named
 * one removes the root membership, and adding to the root is a no-op when a
 * named one already holds the feed. Every write path goes through here.
 */
export async function addFeedToCollection(collectionId: number, feedId: number) {
  const [col] = await db.select({ userId: schema.collections.userId, parentId: schema.collections.parentId }).from(schema.collections).where(eq(schema.collections.id, collectionId));
  if (!col) return;
  if (col.parentId === null) {
    const named = await db.execute(sql`select 1 from collection_feeds cf join collections c on c.id = cf.collection_id where c.user_id = ${col.userId} and c.parent_id is not null and cf.feed_id = ${feedId} limit 1`);
    if (named.rows.length) return;
  }
  await db.insert(schema.collectionFeeds).values({ collectionId, feedId }).onConflictDoNothing();
  if (col.parentId !== null) {
    await db.execute(sql`delete from collection_feeds cf using collections root where cf.collection_id = root.id and root.user_id = ${col.userId} and root.parent_id is null and cf.feed_id = ${feedId}`);
  }
}

export type SubscribeOutcome =
  | { status: "subscribed"; feed: typeof schema.feeds.$inferSelect; alreadyFollowed: boolean }
  | { status: "choose"; candidates: { url: string; title: string | null; kind: string | null }[] }
  | { status: "none"; pageUrl: string };

/** The one acquisition path: any URL in, a followed feed (or a choice) out. */
export async function subscribe(userRootCollectionId: number, input: string, collectionId?: number): Promise<SubscribeOutcome> {
  const d = await discover(input);
  if (d.status === "candidates") return { status: "choose", candidates: d.candidates };
  if (d.status === "none") return { status: "none", pageUrl: d.pageUrl };
  const feed = await ensureFeedFromDiscovery(d);
  const target = collectionId ?? userRootCollectionId;
  const [before] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.collectionFeeds).where(eq(schema.collectionFeeds.feedId, feed.id));
  await addFeedToCollection(target, feed.id);
  return { status: "subscribed", feed, alreadyFollowed: before.n > 0 };
}
