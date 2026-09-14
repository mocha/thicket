/**
 * Feeds are the INSTANCE INDEX: every feed this server knows about, whether or
 * not the current user follows it. "Following" is derived: the feed appears in
 * at least one of the user's collections. Unfollowing removes it from all of
 * them and never touches the shared index.
 */
import { Hono } from "hono";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import { currentUser } from "../lib/user.js";
import { subscribe, addFeedToCollection, defaultCollectionFor } from "../lib/subscribe.js";
import { refreshFeed } from "../feeds/refresh.js";
import { isHttpUrl, normalizeFeedUrl } from "../feeds/normalize.js";
import { refreshIcon } from "../feeds/icons.js";
import { isYouTubeUrl, YOUTUBE_FEED_PATTERN } from "../feeds/youtube.js";

export const feeds = new Hono();

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

/** Columns every feed listing shares: identity, health, stats, and the caller's relationship to it. */
const feedColumns = (userId: number) => sql`
  f.id, f.url, f.site_url as "siteUrl", f.title, f.description, f.kind,
  coalesce(
    nullif(left(trim(both '-' from regexp_replace(lower(f.title), '[^a-z0-9]+', '-', 'g')), 60), ''),
    nullif(trim(both '-' from regexp_replace(lower(split_part(coalesce(f.site_url, f.url), '/', 3)), '[^a-z0-9]+', '-', 'g')), ''),
    'feed'
  ) as slug,
  f.last_fetched_at as "lastFetchedAt", f.next_fetch_at as "nextFetchAt", f.fetch_interval_s as "fetchIntervalS",
  f.consecutive_failures as "consecutiveFailures", f.last_status as "lastStatus", f.last_error as "lastError",
  f.last_item_at as "lastItemAt", f.created_at as "createdAt", f.etag, f.last_modified as "lastModified",
  exists(select 1 from feed_icons fi where fi.feed_id = f.id and not fi.generic) as "hasIcon",
  (select count(*)::int from feeds g where g.title = f.title) as "sameTitle",
  (select count(*)::int from items i where i.feed_id = f.id) as "itemCount",
  (select count(*)::int from items i where i.feed_id = f.id and i.published_at > now() - interval '30 days') as "postsLast30d",
  (select count(distinct col.user_id)::int from collection_feeds cf join collections col on col.id = cf.collection_id where cf.feed_id = f.id) as "followerCount",
  coalesce((select array_agg(cf.collection_id order by cf.collection_id) from collection_feeds cf join collections col on col.id = cf.collection_id and col.user_id = ${userId} where cf.feed_id = f.id), '{}') as "myCollectionIds",
  exists(select 1 from blocks b where b.user_id = ${userId} and b.feed_id = f.id) as "blocked",
  (select fs.display_name from feed_settings fs where fs.user_id = ${userId} and fs.feed_id = f.id) as "displayName",
  coalesce((select fs.hide_shorts from feed_settings fs where fs.user_id = ${userId} and fs.feed_id = f.id), false) as "hideShorts",
  f.url ~* ${YOUTUBE_FEED_PATTERN} as "isYouTube"
`;

function shape(row: any) {
  return { ...row, lastFetchedAt: iso(row.lastFetchedAt), nextFetchAt: iso(row.nextFetchAt), lastItemAt: iso(row.lastItemAt), createdAt: iso(row.createdAt) };
}

/**
 * The index. ?q= searches title/description/url (and the caller's own name for a feed),
 * ?following=1|0 restricts to feeds the user does or does not follow, ?sort= recent|title|followers|posts|added.
 * Offset paginated; fine at tens of thousands, revisit past that.
 */
feeds.get("/", async (c) => {
  const user = currentUser(c);
  const q = (c.req.query("q") ?? "").trim();
  const following = c.req.query("following"); // "1" = only followed, "0" = only not followed, else all
  const network = c.req.query("network"); // "1" = people I follow, "2" = them and the people they follow
  const since = c.req.query("since"); // 24h | week | month | year: when the feed was added to this instance
  const sort = c.req.query("sort") ?? "recent";
  const limit = Math.min(200, Math.max(1, Number(c.req.query("limit") ?? 50)));
  const offset = Math.max(0, Number(c.req.query("offset") ?? 0));

  const where = [sql`true`];
  if (q) {
    const like = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`;
    where.push(sql`(f.title ilike ${like} or f.description ilike ${like} or f.url ilike ${like} or f.site_url ilike ${like}
      or exists(select 1 from feed_settings fs where fs.user_id = ${user.id} and fs.feed_id = f.id and fs.display_name ilike ${like}))`);
  }
  const sinceInterval = since === "24h" ? "1 day" : since === "week" ? "7 days" : since === "month" ? "30 days" : since === "year" ? "365 days" : null;
  if (sinceInterval) where.push(sql`f.created_at > now() - ${sinceInterval}::interval`);
  const followedBy = sql`exists(select 1 from collection_feeds cf join collections col on col.id = cf.collection_id and col.user_id = ${user.id} where cf.feed_id = f.id)`;
  if (following === "1") where.push(followedBy);
  if (following === "0") where.push(sql`not ${followedBy}`);
  // The network is resolved once to a set of user ids, then used as a plain filter and a count.
  let networkIds: number[] | null = null;
  if (network === "1" || network === "2") {
    const depth = Number(network);
    const net = await db.execute<{ id: number }>(sql`
      with recursive net(id, depth) as (
        select followee_id, 1 from user_follows where follower_id = ${user.id}
        union
        select uf.followee_id, net.depth + 1 from user_follows uf join net on uf.follower_id = net.id where net.depth < ${depth}
      )
      select distinct id from net where id <> ${user.id}
    `);
    networkIds = net.rows.map((r) => Number(r.id));
    where.push(networkIds.length
      ? sql`exists(select 1 from collection_feeds cf join collections col on col.id = cf.collection_id where cf.feed_id = f.id and col.user_id in (${sql.join(networkIds.map((id) => sql`${id}`), sql`, `)}))`
      : sql`false`);
  }
  const networkColumn = networkIds?.length
    ? sql`, (select count(distinct col.user_id)::int from collection_feeds cf join collections col on col.id = cf.collection_id where cf.feed_id = f.id and col.user_id in (${sql.join(networkIds.map((id) => sql`${id}`), sql`, `)})) as "networkFollowers"`
    : sql`, null::int as "networkFollowers"`;
  const order =
    sort === "title" ? sql`lower(coalesce(x.title, x.url)) asc`
    : sort === "followers" ? sql`"followerCount" desc, "lastItemAt" desc nulls last`
    : sort === "posts" ? sql`"postsLast30d" desc, "lastItemAt" desc nulls last`
    : sort === "added" ? sql`"createdAt" desc`
    : sql`"lastItemAt" desc nulls last, x.id desc`;

  const rows = await db.execute(sql`
    select * from (select ${feedColumns(user.id)} ${networkColumn} from feeds f where ${sql.join(where, sql` and `)}) x
    order by ${order} limit ${limit + 1} offset ${offset}
  `);
  const [{ total }] = (await db.execute<{ total: number }>(sql`select count(*)::int as total from feeds f where ${sql.join(where, sql` and `)}`)).rows;
  // The unfiltered size of the index, so the page can say "154 of 2,218"
  // rather than leaving a filtered count to be read as the whole thing.
  const [{ indexTotal }] = (await db.execute<{ indexTotal: number }>(sql`select count(*)::int as "indexTotal" from feeds`)).rows;
  const page = rows.rows.slice(0, limit).map(shape);
  return c.json({ feeds: page, total, indexTotal, nextOffset: rows.rows.length > limit ? offset + limit : null });
});

/** Add by URL. This is the endpoint the share target, bookmarklet, or any external tool hits. */
feeds.post("/", async (c) => {
  type Body = { url?: string; collectionId?: number; collectionIds?: number[] };
  const body = await c.req.json<Body>().catch(() => ({} as Body));
  if (!body.url) return c.json({ error: "url is required" }, 400);
  let normalized: string;
  try {
    normalized = normalizeFeedUrl(body.url);
  } catch {
    return c.json({ error: "not a valid URL" }, 400);
  }
  if (!isHttpUrl(normalized)) return c.json({ error: "only http(s) URLs" }, 400);
  const user = currentUser(c);
  // Several collections at once: only the caller's own count; anything else is silently dropped.
  const wanted = [...new Set([...(body.collectionIds ?? []), ...(body.collectionId ? [body.collectionId] : [])].map(Number).filter(Number.isFinite))];
  const mine = wanted.length
    ? (await db.select({ id: schema.collections.id }).from(schema.collections).where(and(eq(schema.collections.userId, user.id), inArray(schema.collections.id, wanted)))).map((r) => r.id)
    : [];
  try {
    const outcome = await subscribe(user, normalized, mine[0]);
    if (outcome.status === "subscribed") for (const id of mine.slice(1)) await addFeedToCollection(id, outcome.feed.id);
    return c.json(outcome, outcome.status === "none" ? 404 : 200);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
  }
});

/** One feed with stats and the caller's relationship to it. */
feeds.get("/:id", async (c) => {
  const user = currentUser(c);
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "not found" }, 404);
  const rows = await db.execute(sql`select ${feedColumns(user.id)} from feeds f where f.id = ${id}`);
  const row = rows.rows[0];
  return row ? c.json(shape(row)) : c.json({ error: "not found" }, 404);
});

/**
 * My settings on this feed: what I call it, and for YouTube whether its Shorts
 * reach my rivers. Per person, and nobody else sees them. Send only what
 * changes; anything left out keeps its current value.
 *
 * A row that would hold only defaults is deleted instead of kept, so a row
 * always means somebody changed something. That keeps the table readable as
 * the answer to "what do people change about this feed?", which is what a
 * later pass will use to suggest defaults for everyone.
 */
feeds.put("/:id/settings", async (c) => {
  const user = currentUser(c);
  const feedId = Number(c.req.param("id"));
  if (!Number.isFinite(feedId)) return c.json({ error: "not found" }, 404);
  const [feed] = await db.select({ title: schema.feeds.title, url: schema.feeds.url }).from(schema.feeds).where(eq(schema.feeds.id, feedId));
  if (!feed) return c.json({ error: "not found" }, 404);
  type Body = { displayName?: string | null; hideShorts?: boolean };
  const body = await c.req.json<Body>().catch(() => ({} as Body));
  const mine = and(eq(schema.feedSettings.userId, user.id), eq(schema.feedSettings.feedId, feedId));
  const [current] = await db.select().from(schema.feedSettings).where(mine);

  let displayName = current?.displayName ?? null;
  if (body.displayName !== undefined) {
    const next = (body.displayName ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
    // Naming a feed what it is already called is the same as not renaming it.
    displayName = next && next !== feed.title ? next : null;
  }
  // Only a YouTube feed has Shorts to hide; elsewhere the setting cannot be switched on.
  const hideShorts = body.hideShorts !== undefined ? body.hideShorts === true && isYouTubeUrl(feed.url) : (current?.hideShorts ?? false);

  if (displayName === null && !hideShorts) {
    await db.delete(schema.feedSettings).where(mine);
  } else {
    await db.insert(schema.feedSettings).values({ userId: user.id, feedId, displayName, hideShorts })
      .onConflictDoUpdate({ target: [schema.feedSettings.userId, schema.feedSettings.feedId], set: { displayName, hideShorts, updatedAt: new Date() } });
  }
  return c.json({ feedId, displayName, hideShorts });
});

const REFRESH_COOLDOWN_S = 5 * 60;

/** Anyone can ask for a refresh; the feed is fetched at most once per cooldown window regardless of who asks. */
feeds.post("/:id/refresh", async (c) => {
  currentUser(c);
  const id = Number(c.req.param("id"));
  const [feed] = await db.select({ lastFetchedAt: schema.feeds.lastFetchedAt }).from(schema.feeds).where(eq(schema.feeds.id, id));
  if (!feed) return c.json({ error: "not found" }, 404);
  const ageS = feed.lastFetchedAt ? (Date.now() - feed.lastFetchedAt.getTime()) / 1000 : Infinity;
  if (ageS < REFRESH_COOLDOWN_S) {
    const retryAfterS = Math.ceil(REFRESH_COOLDOWN_S - ageS);
    c.header("retry-after", String(retryAfterS));
    return c.json({ error: "refreshed recently", retryAfterS, lastFetchedAt: feed.lastFetchedAt?.toISOString() }, 429);
  }
  const result = await refreshFeed(id);
  // The feed's site is paused (feeds/hosts.ts): nothing was fetched, and asking again won't help until it ends.
  if (result.deferredUntil) {
    const retryAfterS = Math.max(1, Math.ceil((result.deferredUntil.getTime() - Date.now()) / 1000));
    c.header("retry-after", String(retryAfterS));
    return c.json({ error: "site paused", reason: result.deferredReason, retryAfterS }, 429);
  }
  return c.json(result);
});

/** Follow = put it in a collection: the one named, or the default. Filing into more is PUT /:id/collections. */
feeds.post("/:id/follow", async (c) => {
  const user = currentUser(c);
  const feedId = Number(c.req.param("id"));
  const body = await c.req.json<{ collectionId?: number }>().catch(() => ({} as { collectionId?: number }));
  const target = body.collectionId ?? (await defaultCollectionFor(user));
  const [col] = await db.select().from(schema.collections).where(and(eq(schema.collections.id, target), eq(schema.collections.userId, user.id)));
  if (!col) return c.json({ error: "collection not found" }, 404);
  if (col.parentId === null) return c.json({ error: "pick a collection to follow into" }, 400);
  await addFeedToCollection(target, feedId);
  return c.json({ feedId, collectionIds: [target] });
});

/** Unfollow: remove from every collection of this user. The feed stays in the index. Returns what was removed for undo. */
feeds.delete("/:id", async (c) => {
  const user = currentUser(c);
  const feedId = Number(c.req.param("id"));
  const mine = await db.select({ id: schema.collections.id }).from(schema.collections).where(eq(schema.collections.userId, user.id));
  const ids = mine.map((m) => m.id);
  const removed = await db.delete(schema.collectionFeeds).where(and(eq(schema.collectionFeeds.feedId, feedId), inArray(schema.collectionFeeds.collectionId, ids))).returning({ collectionId: schema.collectionFeeds.collectionId });
  return c.json({ feedId, collectionIds: removed.map((r) => r.collectionId) });
});

/** Undo an unfollow. */
feeds.post("/:id/restore", async (c) => {
  const user = currentUser(c);
  const feedId = Number(c.req.param("id"));
  const body = await c.req.json<{ collectionIds?: number[] }>().catch(() => ({ collectionIds: [] as number[] }));
  const ids = body.collectionIds?.length ? body.collectionIds : [await defaultCollectionFor(user)];
  await db.insert(schema.collectionFeeds).values(ids.map((collectionId) => ({ collectionId, feedId }))).onConflictDoNothing();
  return c.json({ feedId, collectionIds: ids });
});

/** Replace which of the user's collections hold this feed. Empty list = unfollow. */
feeds.put("/:id/collections", async (c) => {
  const user = currentUser(c);
  const feedId = Number(c.req.param("id"));
  const body = await c.req.json<{ collectionIds: number[] }>().catch(() => ({ collectionIds: [] as number[] }));
  const mine = await db.select({ id: schema.collections.id, parentId: schema.collections.parentId }).from(schema.collections).where(eq(schema.collections.userId, user.id));
  const allowed = new Set(mine.map((m) => m.id));
  const named = new Set(mine.filter((m) => m.parentId !== null).map((m) => m.id));
  // The root is never a destination; asking for it alone is the same as unfollowing.
  const wanted = [...new Set(body.collectionIds ?? [])].filter((id) => named.has(id));
  await db.transaction(async (tx) => {
    await tx.delete(schema.collectionFeeds).where(and(eq(schema.collectionFeeds.feedId, feedId), inArray(schema.collectionFeeds.collectionId, [...allowed])));
    if (wanted.length) await tx.insert(schema.collectionFeeds).values(wanted.map((collectionId) => ({ collectionId, feedId }))).onConflictDoNothing();
  });
  return c.json({ feedId, collectionIds: wanted });
});

/** Block: structural now, UI later. */
feeds.post("/:id/block", async (c) => {
  const user = currentUser(c);
  const feedId = Number(c.req.param("id"));
  await db.insert(schema.blocks).values({ userId: user.id, feedId }).onConflictDoNothing();
  return c.json({ feedId, blocked: true });
});
feeds.delete("/:id/block", async (c) => {
  const user = currentUser(c);
  const feedId = Number(c.req.param("id"));
  await db.delete(schema.blocks).where(and(eq(schema.blocks.userId, user.id), eq(schema.blocks.feedId, feedId)));
  return c.json({ feedId, blocked: false });
});

/** Cached site icon. Long-lived cache headers; the URL is stable per feed and the bytes change at most monthly. */
feeds.get("/:id/icon", async (c) => {
  const id = Number(c.req.param("id"));
  const [icon] = await db.select().from(schema.feedIcons).where(eq(schema.feedIcons.feedId, id));
  if (!icon) return c.body(null, 404);
  const etag = `"${id}-${icon.fetchedAt.getTime()}"`;
  if (c.req.header("if-none-match") === etag) return c.body(null, 304);
  c.header("content-type", icon.contentType);
  c.header("cache-control", "public, max-age=86400, stale-while-revalidate=604800");
  c.header("etag", etag);
  return c.body(new Uint8Array(icon.bytes));
});

/** Re-run icon discovery for one feed now. */
feeds.post("/:id/icon/refresh", async (c) => {
  currentUser(c);
  const id = Number(c.req.param("id"));
  const [feed] = await db.select().from(schema.feeds).where(eq(schema.feeds.id, id));
  if (!feed) return c.json({ error: "not found" }, 404);
  const ok = await refreshIcon(id, feed.siteUrl, feed.url);
  return c.json({ feedId: id, hasIcon: ok });
});
