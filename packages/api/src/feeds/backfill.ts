/**
 * A feed's live document is usually much shorter than what actually exists.
 * This tries to get more of it, honestly, for the cases where "more" is
 * actually there to get. Tested against real feeds before writing any of
 * this, because RSS pagination is mostly theoretical:
 *
 *  - Reddit: the `.rss` address a feed already uses defaults to ~25 items,
 *    but honors `?limit=100` (Reddit's own listing size cap) — in testing
 *    that alone returned 100 items spanning five months for an active
 *    subreddit, no pagination required. Reddit rate-limits unauthenticated
 *    requests per IP hard enough that even a single request moments after
 *    discovery's own fetch of the same subreddit got a 429 in testing (5
 *    seconds apart wasn't enough; the window is at least tens of seconds),
 *    and its `.json` listing API returned 403 outright to a non-browser
 *    client, so this stays on the `.rss` address the feed already uses and
 *    retries a 429 with backoff (5s, 20s, 45s) rather than guessing one fixed
 *    pause. A second page (via `&after=<id>`) is tried only if the first is
 *    still short of the cutoff. Giving up after the retries ends the attempt
 *    quietly; it isn't an error, just the ceiling for right now.
 *  - Any feed that implements RFC 5005 paging (an Atom `<link rel="next">`)
 *    is followed until the cutoff, an all-duplicate page, or no further
 *    link. Cheap to support; essentially unused in the wild today — of
 *    YouTube, Reddit, a WordPress blog and The Verge, none of them do this —
 *    but harmless to keep checking, and some feed generators genuinely do.
 *  - YouTube's public feed has no page, offset, count or date parameter of
 *    any kind: 15 most recent uploads, always, confirmed against a channel
 *    that uploads several times a week and one that uploads twice a year (15
 *    items either way). There is no address that returns more. Real
 *    backfill needs the YouTube Data API (a Google Cloud project, a
 *    quota-limited key) or a scraping tool, both outside thicket's
 *    read-the-feed model, so it is a decision for whoever runs an
 *    instance rather than something this module can fix. Recognized here
 *    and returned immediately, so a catch-up pass over hundreds of channels
 *    doesn't spend a request each to learn the same thing.
 *
 * Runs in the background after a feed is first added (see lib/subscribe.ts);
 * the add-feed request never waits on it. `backfillFeed` is safe to call
 * directly, and idempotent, so a one-off catch-up over existing feeds is just
 * a loop over feed ids.
 */
import { eq } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import { httpGet } from "./http.js";
import { HostCoolingDown } from "./hosts.js";
import { parseFeedDocument, type ParsedFeed } from "./parse.js";
import { storeItems } from "./refresh.js";

export const DEFAULT_BACKFILL_DAYS = 90; // 3 months
export const MAX_BACKFILL_DAYS = 180; // 6 months: the far end of what was asked for

// Whoever calls backfillFeed on a Reddit host almost always just fetched that same host a moment
// ago (discovery, on the initial add); 5 seconds wasn't enough in testing to avoid a 429, so this
// retries with real backoff rather than guessing one fixed pause.
const REDDIT_RETRY_DELAYS_MS = [5_000, 20_000, 45_000];
const GENERIC_MAX_PAGES = 6;

/**
 * GET with 429 retried on backoff. Returns null (or the last 429) once retries
 * are exhausted. A 429 also makes the host-politeness layer pause the whole host
 * (feeds/hosts.ts) for longer than these short delays, so the next attempt would
 * throw HostCoolingDown instead of fetching; catch that and stop, so the caller
 * reports the rate-limit as a result rather than letting backfill throw.
 */
async function fetchWithBackoff(url: string, delaysMs: number[], extra: Record<string, string> = {}) {
  let res;
  for (const delay of delaysMs) {
    await new Promise((r) => setTimeout(r, delay));
    try {
      res = await httpGet(url, extra);
    } catch (e) {
      if (e instanceof HostCoolingDown) break;
      throw e;
    }
    if (res.status !== 429) return res;
  }
  return res ?? null;
}
const NEXT_LINK = /<link\b[^>]*\brel=["']next["'][^>]*\bhref=["']([^"']+)["']|<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\brel=["']next["']/i;

export type BackfillResult = { feedId: number; inserted: number; requests: number; reason: string };

function cutoffDate(days: number): Date {
  return new Date(Date.now() - Math.min(Math.max(days, 1), MAX_BACKFILL_DAYS) * 86_400_000);
}

function oldestOf(parsed: ParsedFeed): Date | null {
  return parsed.items.reduce<Date | null>((m, it) => (it.publishedAt && (!m || it.publishedAt < m) ? it.publishedAt : m), null);
}

export async function backfillFeed(feedId: number, opts: { days?: number } = {}): Promise<BackfillResult> {
  const [feed] = await db.select().from(schema.feeds).where(eq(schema.feeds.id, feedId));
  if (!feed) return { feedId, inserted: 0, requests: 0, reason: "feed not found" };
  let host: string;
  try {
    host = new URL(feed.url).hostname;
  } catch {
    return { feedId, inserted: 0, requests: 0, reason: "feed has no valid url" };
  }
  const before = cutoffDate(opts.days ?? DEFAULT_BACKFILL_DAYS);

  if (/(^|\.)youtube\.com$/i.test(host)) {
    return { feedId, inserted: 0, requests: 0, reason: "youtube's feed has no history beyond its 15 most recent uploads" };
  }
  if (/(^|\.)reddit\.com$/i.test(host)) return redditBackfill(feed, before);
  return genericPagedBackfill(feed, before);
}

/** Extract Reddit's fullname (t3_…) back out of a dedupeKey built as `guid:<id>` — the Atom <id> Reddit publishes IS the fullname `after` expects. */
function fullnameOf(dedupeKey: string): string | null {
  const m = /^guid:(t[13]_\w+)$/.exec(dedupeKey);
  return m?.[1] ?? null;
}

async function redditBackfill(feed: typeof schema.feeds.$inferSelect, before: Date): Promise<BackfillResult> {
  const url = new URL(feed.url);
  url.searchParams.set("limit", "100");
  let requests = 0;
  let inserted = 0;
  let lastReason = "";
  for (let page = 0; page < 2; page++) {
    const res = await fetchWithBackoff(url.toString(), REDDIT_RETRY_DELAYS_MS, { accept: "application/atom+xml, application/rss+xml, application/xml" });
    requests++;
    if (!res || res.status === 429) { lastReason = "Reddit kept rate-limiting us; giving up for now"; break; }
    if (res.status >= 400) { lastReason = `Reddit answered HTTP ${res.status}`; break; }
    let parsed: ParsedFeed;
    try {
      parsed = parseFeedDocument(res.body, res.finalUrl);
    } catch {
      lastReason = "Reddit returned something unparsable";
      break;
    }
    if (parsed.items.length === 0) { lastReason = "nothing more to fetch"; break; }
    const { inserted: n } = await storeItems(feed.id, parsed);
    inserted += n;
    if (n === 0) { lastReason = "caught up with what was already stored"; break; }
    const oldest = oldestOf(parsed);
    if (!oldest || oldest < before) { lastReason = `reached the ${before.toISOString().slice(0, 10)} cutoff`; break; }
    const last = fullnameOf(parsed.items[parsed.items.length - 1].dedupeKey);
    if (!last) { lastReason = "no cursor to page further"; break; }
    url.searchParams.set("after", last);
    lastReason = "still short of the cutoff after one page; trying a second";
  }
  return { feedId: feed.id, inserted, requests, reason: inserted ? `+${inserted} items · ${lastReason}` : lastReason || "no items returned" };
}

async function genericPagedBackfill(feed: typeof schema.feeds.$inferSelect, before: Date): Promise<BackfillResult> {
  let url = feed.url;
  const seen = new Set([url]);
  let requests = 0;
  let inserted = 0;
  let pages = 0;
  let reason = "no rel=\"next\" paging advertised";
  while (pages < GENERIC_MAX_PAGES) {
    const res = await httpGet(url);
    requests++;
    if (res.status >= 400) { reason = `HTTP ${res.status} following the next page`; break; }
    let parsed: ParsedFeed;
    try {
      parsed = parseFeedDocument(res.body, res.finalUrl);
    } catch {
      reason = "unparsable page";
      break;
    }
    // Page 1 is the same document the feed's normal add-time fetch already stored; only pages
    // reached by following rel="next" are new territory.
    if (pages > 0) {
      const { inserted: n } = await storeItems(feed.id, parsed);
      inserted += n;
      if (n === 0) { reason = "caught up with what was already stored"; break; }
      const oldest = oldestOf(parsed);
      if (oldest && oldest < before) { reason = `reached the ${before.toISOString().slice(0, 10)} cutoff`; break; }
    }
    const m = NEXT_LINK.exec(res.body);
    const next = m?.[1] ?? m?.[2];
    if (!next) break;
    let abs: string;
    try {
      abs = new URL(next, res.finalUrl).toString();
    } catch {
      break;
    }
    if (seen.has(abs)) break;
    seen.add(abs);
    url = abs;
    pages++;
    reason = `followed rel="next" ${pages} page(s)`;
  }
  return { feedId: feed.id, inserted, requests, reason: inserted ? `+${inserted} items · ${reason}` : reason };
}
