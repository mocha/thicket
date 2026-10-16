import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import type { SessionUser } from "./auth.js";
import { slugify, slugTaken } from "./slug.js";
import { discover, type Discovery } from "../feeds/discover.js";
import { normalizeFeedUrl } from "../feeds/normalize.js";
import { storeItems, chooseInterval } from "../feeds/refresh.js";
import { backfillFeed } from "../feeds/backfill.js";
import { existingFeedId } from "../feeds/twins.js";

const feedById = async (id: number) => (await db.select().from(schema.feeds).where(eq(schema.feeds.id, id)))[0];

/** How soon a channel followed while its feed wasn't answering is tried again. */
const WAITING_RETRY_MS = 5 * 60_000;

/** Get-or-create a global feed row from a discovery result and store its first batch of items. */
export async function ensureFeedFromDiscovery(d: Extract<Discovery, { status: "feed" }>) {
  // Over either scheme: following http://x when thicket has https://x follows the one it has.
  const known = await existingFeedId(d.url);
  const existing = known === null ? undefined : await feedById(known);
  if (existing) return existing;
  const { newestAt } = { newestAt: d.parsed.items.reduce<Date | null>((m, i) => (i.publishedAt && (!m || i.publishedAt > m) ? i.publishedAt : m), null) };
  const interval = chooseInterval(newestAt);
  // A channel whose feed isn't answering (feeds/discover.ts): never fetched, so the scheduler tries it soon.
  const fetched = d.waiting
    ? { lastFetchedAt: null, lastStatus: null, nextFetchAt: new Date(Date.now() + WAITING_RETRY_MS) }
    : { lastFetchedAt: new Date(), lastStatus: 200, nextFetchAt: new Date(Date.now() + interval * 1000) };
  const [feed] = await db
    .insert(schema.feeds)
    .values({
      url: d.url,
      siteUrl: d.parsed.siteUrl,
      title: d.parsed.title,
      description: d.parsed.description,
      kind: d.parsed.kind,
      // What refreshFeed would record from the same document. It keeps the
      // validators below, so the next check is often a 304 that rewrites
      // neither: anything left out here stays missing until the feed changes.
      language: d.parsed.language,
      categories: d.parsed.categories.length ? d.parsed.categories : null,
      etag: d.etag,
      lastModified: d.lastModified,
      lastItemAt: newestAt,
      fetchIntervalS: interval,
      ...fetched,
    })
    .onConflictDoNothing()
    .returning();
  const row = feed ?? (await db.select().from(schema.feeds).where(eq(schema.feeds.url, d.url)))[0];
  await storeItems(row.id, d.parsed, { firstFetch: true });
  if (!d.waiting) {
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
  const known = await existingFeedId(normalized);
  if (known !== null) return feedById(known);
  const [row] = await db.insert(schema.feeds).values({ url: normalized, nextFetchAt: new Date() }).onConflictDoNothing().returning();
  return row ?? (await db.select().from(schema.feeds).where(eq(schema.feeds.url, normalized)))[0];
}

/**
 * Where a bare "Follow" files a feed: the person's oldest collection. Null
 * when they have none: a new account starts with no collections, and the
 * follow then names one for the feed to start (see destinationFor).
 */
export async function defaultCollectionFor(user: SessionUser): Promise<number | null> {
  if (user.defaultCollectionId !== null) return user.defaultCollectionId;
  const [existing] = await db
    .select({ id: schema.collections.id })
    .from(schema.collections)
    .where(and(eq(schema.collections.userId, user.id), isNotNull(schema.collections.parentId)))
    .orderBy(schema.collections.id)
    .limit(1);
  return existing?.id ?? null;
}

/**
 * Where a follow goes: a collection of mine, or a new one I'm naming now.
 * A new one is only made once the feed is found (fileInto), so a follow that
 * fails leaves no empty collection behind.
 */
export type Destination = { id: number } | { name: string };

/**
 * Settle where a follow goes before anything is fetched. The collection asked
 * for wins; then a new one by name; then the default. With no collections and
 * no name there is nowhere to put it, and the answer says so.
 */
export async function destinationFor(user: SessionUser, collectionId: number | undefined, newName: unknown): Promise<Destination | { error: string }> {
  if (collectionId !== undefined) return { id: collectionId };
  const name = typeof newName === "string" ? newName.trim() : "";
  if (name) {
    if (await slugTaken(user.id, slugify(name))) return { error: "You already have a collection with that name." };
    return { name };
  }
  const fallback = await defaultCollectionFor(user);
  return fallback === null ? { error: "Name a collection to follow this feed into." } : { id: fallback };
}

/** The collection a follow lands in, making the named one now if that's what was asked for. */
export async function fileInto(user: SessionUser, dest: Destination): Promise<number> {
  if ("id" in dest) return dest.id;
  const slug = slugify(dest.name);
  const [made] = await db
    .insert(schema.collections)
    .values({ userId: user.id, parentId: user.rootCollectionId, name: dest.name, slug })
    .onConflictDoNothing()
    .returning();
  if (made) return made.id;
  // Two follows naming the same new collection at once: the second files into the one the first made.
  const [same] = await db.select({ id: schema.collections.id }).from(schema.collections)
    .where(and(eq(schema.collections.userId, user.id), eq(schema.collections.slug, slug)));
  return same.id;
}

/**
 * Put a feed in a collection. Every write path goes through here. The root row
 * is the tree's parent and nothing else: a feed filed there would be followed
 * but in no collection, which is the state this app no longer has.
 */
export async function addFeedToCollection(collectionId: number, feedId: number) {
  const [col] = await db.select({ userId: schema.collections.userId, parentId: schema.collections.parentId }).from(schema.collections).where(eq(schema.collections.id, collectionId));
  if (!col || col.parentId === null) return;
  await db.insert(schema.collectionFeeds).values({ collectionId, feedId }).onConflictDoNothing();
}

/**
 * A feed's row as anyone who follows it may see it. Its categories are left
 * out: what a feed sends is shown to admins only for now (issue #189, through
 * /api/admin), and POST /api/feeds hands this to whoever followed.
 */
export type FollowedFeed = Omit<typeof schema.feeds.$inferSelect, "categories">;

export type SubscribeOutcome =
  // `waiting`: followed, but its posts arrive later (a YouTube channel whose feed wasn't answering).
  | { status: "subscribed"; feed: FollowedFeed; alreadyFollowed: boolean; waiting: boolean }
  | { status: "choose"; candidates: { url: string; title: string | null; kind: string | null }[] }
  | { status: "none"; pageUrl: string };

/** The one acquisition path: any URL in, a followed feed (or a choice) out. */
export async function subscribe(user: SessionUser, input: string, dest: Destination): Promise<SubscribeOutcome> {
  const d = await discover(input);
  if (d.status === "candidates") return { status: "choose", candidates: d.candidates };
  if (d.status === "none") return { status: "none", pageUrl: d.pageUrl };
  const { categories: _adminOnly, ...feed } = await ensureFeedFromDiscovery(d);
  const [before] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.collectionFeeds).where(eq(schema.collectionFeeds.feedId, feed.id));
  await addFeedToCollection(await fileInto(user, dest), feed.id);
  return { status: "subscribed", feed, alreadyFollowed: before.n > 0, waiting: d.waiting === true && feed.lastFetchedAt === null };
}
