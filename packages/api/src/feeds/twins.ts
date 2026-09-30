/**
 * Finding a feed that is another feed entered twice. merge.ts folds redirects
 * (one address that lands on another); this catches the two cases a redirect
 * never reveals, both of which put the same publication in Explore twice:
 *
 * - The same address over http and https, when the site answers on both
 *   without redirecting. The https row is the one kept.
 * - Two addresses for one feed on the same site — /feed and /rss.xml, with and
 *   without www, a mirror like hnrss.org — told apart by what they publish, not
 *   by their names. Titles are a trap: a site's "World" and "Sports" feeds look
 *   alike and are different feeds.
 *
 * "Publishes the same thing" is judged over the stretch of time both feeds
 * cover, in both directions: nearly every post in either is in the other. A
 * section feed fails that against its site's main feed, because the main feed
 * is full of posts from other sections over the same days.
 */
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";

/** Recent posts compared per feed, and the share that must match both ways. */
const WINDOW = 30;
const MIN_SHARED = 3;
const MIN_OVERLAP = 0.8;

export type Twin = { keep: number; drop: number; why: string };

/** The same address with the other scheme, or null when it isn't http(s). */
export function otherScheme(url: string): string | null {
  if (url.startsWith("https://")) return `http://${url.slice(8)}`;
  if (url.startsWith("http://")) return `https://${url.slice(7)}`;
  return null;
}

/** A post's link reduced to what identifies the page: no scheme, www, fragment or trailing slash. */
export function linkKey(url: string): string {
  return url.trim().toLowerCase().replace(/#.*$/, "").replace(/^https?:\/\/(www\.)?/, "").replace(/\/+(\?|$)/, "$1");
}

/** A site address reduced the same way, so http://www.x.com/ and https://x.com match. */
const siteKeySql = (col: ReturnType<typeof sql>) =>
  sql`regexp_replace(regexp_replace(lower(${col}), '^https?://(www\\.)?', ''), '/+$', '')`;

type Post = { key: string; at: number };

async function recentPosts(feedId: number): Promise<Post[]> {
  const rows = await db.execute<{ url: string; at: string }>(sql`
    select url, published_at as at from items
    where feed_id = ${feedId} and url is not null
    order by published_at desc, id desc limit ${WINDOW}`);
  return rows.rows.map((r) => ({ key: linkKey(r.url), at: new Date(r.at).getTime() }));
}

/** True when a and b list the same posts over the time both of them cover. */
export function samePosts(a: Post[], b: Post[]): boolean {
  if (!a.length || !b.length) return false;
  const since = Math.max(Math.min(...a.map((p) => p.at)), Math.min(...b.map((p) => p.at)));
  const inA = new Set(a.filter((p) => p.at >= since).map((p) => p.key));
  const inB = new Set(b.filter((p) => p.at >= since).map((p) => p.key));
  if (inA.size < MIN_SHARED || inB.size < MIN_SHARED) return false;
  const shared = [...inA].filter((k) => inB.has(k)).length;
  return shared >= MIN_SHARED && shared / inA.size >= MIN_OVERLAP && shared / inB.size >= MIN_OVERLAP;
}

type Row = { id: number; url: string; followers: number };

/**
 * Which of two rows survives: the one more people follow, then https, then the
 * older row. Merging keeps everyone's follows either way; this only decides
 * which address thicket keeps fetching.
 */
function pick(a: Row, b: Row): { keep: number; drop: number } {
  const score = (r: Row) => [r.followers, r.url.startsWith("https://") ? 1 : 0, -r.id];
  const [sa, sb] = [score(a), score(b)];
  for (let i = 0; i < sa.length; i++) {
    if (sa[i] !== sb[i]) return sa[i] > sb[i] ? { keep: a.id, drop: b.id } : { keep: b.id, drop: a.id };
  }
  return { keep: a.id, drop: b.id };
}

const followersSql = sql`(select count(distinct col.user_id)::int from collection_feeds cf join collections col on col.id = cf.collection_id where cf.feed_id = f.id)`;

/**
 * The row thicket already has for this address, over either scheme, https first.
 * Used when a feed is added, so http://x never becomes a second row beside https://x.
 */
export async function existingFeedId(url: string): Promise<number | null> {
  const flipped = otherScheme(url);
  const [row] = (await db.execute<{ id: number }>(sql`
    select id from feeds where url in (${url}, ${flipped ?? url})
    order by (url = ${url}) desc, (url like 'https://%') desc limit 1`)).rows;
  return row ? Number(row.id) : null;
}

/** The feed this one duplicates, if any, and which of the two to keep. */
export async function findTwin(feedId: number): Promise<Twin | null> {
  const [me] = (await db.execute<Row & { siteUrl: string | null }>(sql`
    select f.id, f.url, f.site_url as "siteUrl", ${followersSql} as followers from feeds f where f.id = ${feedId}`)).rows;
  if (!me) return null;
  me.id = Number(me.id);

  // The http/https pair needs no content check: same address, same feed. The https row is
  // kept regardless of followers, since the http row is only the stale spelling of it.
  const flipped = otherScheme(me.url);
  if (flipped) {
    const [other] = (await db.execute<{ id: number }>(sql`select id from feeds where url = ${flipped}`)).rows;
    if (other) {
      const [keep, drop] = me.url.startsWith("https://") ? [me.id, Number(other.id)] : [Number(other.id), me.id];
      return { keep, drop, why: "the same address over http and https" };
    }
  }

  if (!me.siteUrl) return null;
  const candidates = (await db.execute<Row>(sql`
    select f.id, f.url, ${followersSql} as followers from feeds f
    where f.id <> ${me.id} and f.site_url is not null and ${siteKeySql(sql`f.site_url`)} = ${siteKeySql(sql`${me.siteUrl}`)}
    order by f.id limit 50`)).rows;
  if (!candidates.length) return null;
  const mine = await recentPosts(me.id);
  for (const c of candidates) {
    const other = { ...c, id: Number(c.id) };
    if (samePosts(mine, await recentPosts(other.id))) return { ...pick(me, other), why: "same site, same posts" };
  }
  return null;
}
