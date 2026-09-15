/**
 * Fetch one feed, store new items, update its schedule. The unit of work the
 * scheduler hands out. Safe to call directly (manual refresh, seeding).
 */
import { eq, sql } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import { httpGet } from "./http.js";
import { parseFeedDocument, type ParsedFeed } from "./parse.js";
import { ICON_RECHECK_MS, refreshIcon } from "./icons.js";
import { HostCoolingDown, coolingUntil, feedOutcome, hostKey } from "./hosts.js";
import { normalizeFeedUrl } from "./normalize.js";
import { mergeFeeds } from "./merge.js";
import { markRepeats } from "./repeats.js";

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

/**
 * When to check a feed next: `seconds` from now, give or take a tenth. Without
 * the spread, feeds first fetched in the same minute stay due in the same
 * minute forever. The 1,530 feeds seeded on the afternoon of 2026-09-13 made
 * 17:00 CDT production's busiest hour a day later, at nearly three times the
 * normal rate.
 */
export function nextCheck(seconds: number, now = Date.now()): Date {
  return new Date(now + seconds * 1000 * (0.9 + Math.random() * 0.2));
}

export type RefreshResult = {
  feedId: number; status: number | null; itemsNew: number; error: string | null; durationMs: number;
  /** Set when nothing was fetched because the feed's host is paused (feeds/hosts.ts). */
  deferredUntil?: Date | null; deferredReason?: string | null;
  /** Set when this fetch showed the feed to be another feed's address and it was folded into it (feeds/merge.ts). `feedId` is then the feed that remains. */
  mergedFrom?: number;
};

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
  // A document that lists one post twice would make the upsert below touch a row twice, which Postgres refuses.
  const seen = new Set<string>();
  const rows = parsed.items.filter((it) => !seen.has(it.dedupeKey) && !!seen.add(it.dedupeKey)).map((it) => ({
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
  /**
   * A post we already hold can come back carrying a body we never stored:
   * YouTube descriptions before 2026-09-15, or anything the parser learns to
   * read later. Fill that gap; never overwrite a body we have. `xmax = 0` is
   * how Postgres tells a fresh insert from that fill, so only real arrivals
   * count as new.
   */
  const written = await db.insert(schema.items).values(rows)
    .onConflictDoUpdate({
      target: [schema.items.feedId, schema.items.dedupeKey],
      set: { content: sql`excluded.content`, summary: sql`coalesce(${schema.items.summary}, excluded.summary)` },
      setWhere: sql`${schema.items.content} is null and excluded.content is not null`,
    })
    .returning({ id: schema.items.id, fresh: sql<boolean>`(xmax = 0)` });
  const fresh = written.filter((r) => r.fresh).map((r) => Number(r.id));
  // Reposts are flagged, never dropped (feeds/repeats.ts). Failing to flag must not lose the fetch.
  if (fresh.length) await markRepeats(fresh).catch((e) => console.error(`[repeats] feed ${feedId}:`, e));
  const newestAt = rows.reduce<Date | null>((m, r) => (!m || r.publishedAt > m ? r.publishedAt : m), null);
  return { inserted: fresh.length, newestAt };
}

/** A little after a pause ends, so a host's feeds don't all return in the same second. */
const afterPause = (until: Date) => new Date(until.getTime() + Math.random() * 5 * 60_000);

const canonicalUrl = (url: string) => {
  try { return normalizeFeedUrl(url); } catch { return null; }
};

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
  const outcome = (failure: string | null) => feedOutcome(feed.url, feedId, failure).catch(() => {});

  try {
    const conditional: Record<string, string> = {};
    if (feed.etag) conditional["if-none-match"] = feed.etag;
    if (feed.lastModified) conditional["if-modified-since"] = feed.lastModified;
    const res = await httpGet(feed.url, conditional);

    // Told to slow down. The host is now paused for every feed on it (feeds/hosts.ts);
    // this feed did nothing wrong, so it waits with the rest rather than counting a failure.
    const paused = coolingUntil(hostKey(feed.url));
    if (paused && (res.status === 429 || res.status === 503)) {
      const note = `HTTP ${res.status}: the site asked thicket to wait`;
      return done({ lastStatus: res.status, lastError: note, nextFetchAt: afterPause(paused) }, { status: res.status, itemsNew: 0, error: note });
    }

    // This address answered from an address another feed already has. A feed is the
    // address fetched, so they are one feed entered twice: fold this one into that one.
    // Checked before "not modified" too, or a site that answers 304 would never be merged.
    const landed = res.status < 400 ? canonicalUrl(res.finalUrl) : null;
    if (landed && landed !== feed.url) {
      const [twin] = await db.select({ id: schema.feeds.id }).from(schema.feeds).where(eq(schema.feeds.url, landed));
      if (twin && twin.id !== feedId) {
        // Parsed before merging: a document that fails to parse leaves both feeds as they were.
        const document = res.status === 304 ? null : parseFeedDocument(res.body, res.finalUrl);
        await mergeFeeds(feedId, twin.id);
        await outcome(null);
        const inserted = document ? (await storeItems(twin.id, document)).inserted : 0;
        const durationMs = Date.now() - started;
        await db.insert(schema.fetchLog).values({ feedId: twin.id, status: res.status, durationMs, itemsNew: inserted, error: null });
        return { feedId: twin.id, mergedFrom: feedId, status: res.status, itemsNew: inserted, error: null, durationMs };
      }
    }

    if (res.status === 304) {
      await outcome(null);
      const interval = chooseInterval(feed.lastItemAt);
      return done({ lastStatus: 304, lastError: null, consecutiveFailures: 0, fetchIntervalS: interval, nextFetchAt: nextCheck(interval) }, { status: 304, itemsNew: 0, error: null });
    }
    if (res.status >= 400) throw new Error(`HTTP ${res.status}`);

    const parsed = parseFeedDocument(res.body, res.finalUrl);

    const { inserted, newestAt } = await storeItems(feedId, parsed, { firstFetch: feed.lastFetchedAt === null });
    await outcome(null);
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
        nextFetchAt: nextCheck(interval),
      },
      { status: res.status, itemsNew: inserted, error: null },
    );
  } catch (err) {
    // Nothing was requested: the host is paused, or its queue is long. Not a fetch, not a failure; just come back later.
    if (err instanceof HostCoolingDown) {
      await db.update(schema.feeds).set({ nextFetchAt: afterPause(err.until), updatedAt: new Date() }).where(eq(schema.feeds.id, feedId));
      return { feedId, durationMs: Date.now() - started, status: null, itemsNew: 0, error: null, deferredUntil: err.until, deferredReason: err.message };
    }
    const message = err instanceof Error ? err.message : String(err);
    const failures = feed.consecutiveFailures + 1;
    const status = /^HTTP (\d+)/.exec(message) ? Number(/^HTTP (\d+)/.exec(message)![1]) : null;
    await outcome(status ? `HTTP ${status}` : /timeout|aborted/i.test(message) ? "timeout" : message.slice(0, 60));
    const wait = backoff(feed.fetchIntervalS, failures);
    return done({ lastStatus: status, lastError: message.slice(0, 500), consecutiveFailures: failures, nextFetchAt: nextCheck(wait) }, { status, itemsNew: 0, error: message.slice(0, 500) });
  }
}

/**
 * Feeds that are due, oldest-due first, at most two per site. Without the cap
 * one site with hundreds of due feeds (432 YouTube channels) fills the whole
 * window, the scheduler can only take one of them per host, and every other
 * site waits behind it.
 */
export async function dueFeeds(limit: number) {
  const rows = await db.execute<{ id: number; url: string }>(sql`
    select id, url from (
      select id, url, next_fetch_at,
             row_number() over (partition by substring(split_part(url, '/', 3) from '[^.]+\\.[^.]+$') order by next_fetch_at) as rn
      from feeds where next_fetch_at <= now()
    ) due
    where rn <= 2
    order by next_fetch_at
    limit ${limit}
  `);
  return rows.rows.map((r) => ({ id: Number(r.id), url: r.url }));
}
