/**
 * Fetch one feed, store new items, update its schedule. The unit of work the
 * scheduler hands out. Safe to call directly (manual refresh, seeding).
 */
import { eq, sql } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import { httpGet } from "./http.js";
import { parseFeedDocument, type ParsedFeed } from "./parse.js";
import { ICON_RECHECK_MS, refreshIcon } from "./icons.js";
import { youTubeVariant } from "./youtube.js";

const MIN_INTERVAL_S = 15 * 60;
const MAX_INTERVAL_S = 24 * 60 * 60;
const MAX_BACKOFF_S = 7 * 24 * 60 * 60;

/**
 * Adaptive polling. Intentionally crude: the interval follows how recently the
 * feed last produced something. Upgrade path is per-feed cadence estimation
 * from item timestamps; this gets ~80% of the benefit for one line of code.
 */
export function chooseInterval(lastItemAt: Date | null, now = new Date()): number {
  if (!lastItemAt) return 6 * 3600;
  const ageH = (now.getTime() - lastItemAt.getTime()) / 3_600_000;
  if (ageH < 24) return 30 * 60;
  if (ageH < 24 * 7) return 2 * 3600;
  if (ageH < 24 * 30) return 6 * 3600;
  return MAX_INTERVAL_S;
}

export function backoff(baseS: number, failures: number): number {
  return Math.min(MAX_BACKOFF_S, Math.max(MIN_INTERVAL_S, baseS) * 2 ** Math.min(failures, 10));
}

export type RefreshResult = { feedId: number; status: number | null; itemsNew: number; error: string | null; durationMs: number };

/** Insert parsed items, ignoring ones we've seen. Returns count inserted. */
export async function storeItems(feedId: number, parsed: ParsedFeed, opts: { firstFetch?: boolean } = {}): Promise<{ inserted: number; newestAt: Date | null }> {
  if (parsed.items.length === 0) return { inserted: 0, newestAt: null };
  const now = new Date();
  // Undated items: on a feed's FIRST fetch they are backfill, not news, so spread them one
  // per day backwards in feed order instead of dumping them all at the top of the river.
  // On later fetches an undated item really is new and gets "now".
  let undated = 0;
  const dateFor = (d: Date | null) => {
    if (d && d <= now) return d;
    return opts.firstFetch ? new Date(now.getTime() - undated++ * 86_400_000) : now;
  };
  const rows = parsed.items.map((it) => ({
    feedId,
    dedupeKey: it.dedupeKey,
    url: it.url,
    title: it.title,
    author: it.author,
    summary: it.summary,
    content: it.content,
    imageUrl: it.imageUrl,
    publishedAt: dateFor(it.publishedAt),
  }));
  const inserted = await db.insert(schema.items).values(rows).onConflictDoNothing({ target: [schema.items.feedId, schema.items.dedupeKey] }).returning({ id: schema.items.id });
  const newestAt = rows.reduce<Date | null>((m, r) => (!m || r.publishedAt > m ? r.publishedAt : m), null);
  return { inserted: inserted.length, newestAt };
}

export async function refreshFeed(feedId: number): Promise<RefreshResult> {
  const started = Date.now();
  const [feed] = await db.select().from(schema.feeds).where(eq(schema.feeds.id, feedId));
  if (!feed) throw new Error(`feed ${feedId} not found`);

  const done = async (patch: Partial<typeof schema.feeds.$inferInsert>, result: Omit<RefreshResult, "feedId" | "durationMs">) => {
    const durationMs = Date.now() - started;
    await db.update(schema.feeds).set({ ...patch, lastFetchedAt: new Date(), updatedAt: new Date() }).where(eq(schema.feeds.id, feedId));
    await db.insert(schema.fetchLog).values({ feedId, status: result.status, durationMs, itemsNew: result.itemsNew, error: result.error });
    return { feedId, durationMs, ...result };
  };

  try {
    const conditional: Record<string, string> = {};
    if (feed.etag) conditional["if-none-match"] = feed.etag;
    if (feed.lastModified) conditional["if-modified-since"] = feed.lastModified;
    // Some addresses name a feed thicket derives from another one (feeds/youtube.ts). The etag and
    // last-modified below then belong to the document we actually fetch, which is what 304 should track.
    const variant = youTubeVariant(feed.url);
    const res = await httpGet(variant?.fetchUrl ?? feed.url, conditional);

    if (res.status === 304) {
      const interval = chooseInterval(feed.lastItemAt);
      return done({ lastStatus: 304, lastError: null, consecutiveFailures: 0, fetchIntervalS: interval, nextFetchAt: new Date(Date.now() + interval * 1000) }, { status: 304, itemsNew: 0, error: null });
    }
    if (res.status >= 400) throw new Error(`HTTP ${res.status}`);

    const document = parseFeedDocument(res.body, res.finalUrl);
    const parsed = variant ? await variant.transform(document) : document;
    const { inserted, newestAt } = await storeItems(feedId, parsed, { firstFetch: feed.lastFetchedAt === null });
    // Site icon: checked on first successful fetch and then monthly. Failures are recorded so we don't hammer sites.
    if (!feed.iconCheckedAt || Date.now() - feed.iconCheckedAt.getTime() > ICON_RECHECK_MS) {
      await refreshIcon(feedId, parsed.siteUrl ?? feed.siteUrl, feed.url).catch(() => {});
    }
    const lastItemAt = newestAt && (!feed.lastItemAt || newestAt > feed.lastItemAt) ? newestAt : feed.lastItemAt;
    const interval = chooseInterval(lastItemAt);
    return done(
      {
        kind: parsed.kind,
        title: feed.title ?? parsed.title,
        description: parsed.description ?? feed.description,
        siteUrl: parsed.siteUrl ?? feed.siteUrl,
        etag: res.headers.get("etag"),
        lastModified: res.headers.get("last-modified"),
        lastStatus: res.status,
        lastError: null,
        consecutiveFailures: 0,
        lastItemAt,
        fetchIntervalS: interval,
        nextFetchAt: new Date(Date.now() + interval * 1000),
      },
      { status: res.status, itemsNew: inserted, error: null },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const failures = feed.consecutiveFailures + 1;
    const status = /^HTTP (\d+)/.exec(message) ? Number(/^HTTP (\d+)/.exec(message)![1]) : null;
    const wait = backoff(feed.fetchIntervalS, failures);
    return done({ lastStatus: status, lastError: message.slice(0, 500), consecutiveFailures: failures, nextFetchAt: new Date(Date.now() + wait * 1000) }, { status, itemsNew: 0, error: message.slice(0, 500) });
  }
}

/** Feeds that are due, oldest-due first. */
export async function dueFeeds(limit: number) {
  return db
    .select({ id: schema.feeds.id, url: schema.feeds.url })
    .from(schema.feeds)
    .where(sql`${schema.feeds.nextFetchAt} <= now()`)
    .orderBy(schema.feeds.nextFetchAt)
    .limit(limit);
}
