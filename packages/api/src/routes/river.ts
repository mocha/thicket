/**
 * The river: everything the user follows, newest first, keyset-paginated.
 * Optional ?collection=<id> scopes to that collection's subtree.
 * Blocked feeds are excluded and the count of hidden items is reported, so the
 * UI can say "N posts hidden by your blocks" without saying which.
 * The reader's own feed settings apply here: their name for a feed, and Shorts
 * left out of a YouTube feed they have set to hide them, or of every YouTube
 * feed when that is their default (feed_settings, users.hide_shorts_by_default).
 */
import { Hono } from "hono";
import { sql, type SQL } from "drizzle-orm";
import { db } from "../db/client.js";
import { currentUser } from "../lib/user.js";
import { noteColumns } from "../lib/notes.js";
import { visitorCap } from "../lib/instance.js";
import { SHORTS_URL_PATTERN } from "../feeds/youtube.js";
import { feedSlugSql } from "../lib/slug.js";

export const river = new Hono();

export type RiverItem = {
  id: number; feedId: number; feedTitle: string | null; feedSlug: string; siteUrl: string | null;
  url: string | null; title: string | null; author: string | null; summary: string | null;
  imageUrl: string | null; publishedAt: string; hasIcon: boolean; bookmarkId: number | null;
  myNote: { id: number; body: string; createdAt: string; updatedAt: string } | null;
  notes: { id: number; body: string; createdAt: string; updatedAt: string; author: { handle: string; displayName: string | null } }[];
  /** Earlier posts on the same feed that this one appears to repeat, newest first, at most five (feeds/repeats.ts). */
  repeatOf: { id: number; publishedAt: string; url: string | null; title: string | null }[];
};

/** Is this item a Short? False, not null, when the item has no address: a hidden post must be one we are sure of. */
export const isShort = sql`coalesce(i.url ~ ${SHORTS_URL_PATTERN}, false)`;

/** This reader's Shorts default, for feeds they have not set either way. Signed out, there is none. */
export const shortsDefault = (userId: number) => sql`coalesce((select u.hide_shorts_by_default from users u where u.id = ${userId}), false)`;

/** Does this reader leave Shorts out of this feed? Their setting on it, else their default. */
const hidesShorts = (userId: number, feedId: SQL) =>
  sql`coalesce((select fs.hide_shorts from feed_settings fs where fs.user_id = ${userId} and fs.feed_id = ${feedId}), ${shortsDefault(userId)})`;

/** The numbers under "All my feeds": what you follow, and what arrived in the last day. */
river.get("/stats", async (c) => {
  const user = currentUser(c);
  const [row] = (await db.execute<{ feeds: number; collections: number; posts24h: number; feeds24h: number }>(sql`
    with followed as (select distinct cf.feed_id from collection_feeds cf join collections col on col.id = cf.collection_id where col.user_id = ${user.id}),
         fresh as (select i.feed_id from items i join followed on followed.feed_id = i.feed_id
                   where i.published_at > now() - interval '24 hours' and i.published_at <= now() + interval '1 hour'
                     and not exists(select 1 from blocks b where b.user_id = ${user.id} and b.feed_id = i.feed_id)
                     and not (${isShort} and ${hidesShorts(user.id, sql`i.feed_id`)}))
    select (select count(*)::int from followed) as feeds,
           (select count(*)::int from collections where user_id = ${user.id} and parent_id is not null) as collections,
           (select count(*)::int from fresh) as "posts24h",
           (select count(distinct feed_id)::int from fresh) as "feeds24h"
  `)).rows;
  return c.json(row);
});

river.get("/", async (c) => {
  const collectionId = c.req.query("collection") ? Number(c.req.query("collection")) : null;
  const feedId = c.req.query("feed") ? Number(c.req.query("feed")) : null;
  // "Everything" is mine and needs me signed in. A single feed or a public
  // collection can be read by anyone; bookmark/block columns just come back empty.
  const user = feedId || collectionId ? c.get("user") : currentUser(c);
  const userId = user?.id ?? -1;
  // Signed out, one page of at most VISITOR_CAP and nothing after it (lib/instance.ts).
  const cap = await visitorCap(user);
  const limit = Math.min(cap ?? 100, Math.max(1, Number(c.req.query("limit") ?? 40)));
  const before = c.req.query("before"); // "<iso>|<id>" cursor
  if (cap && before) return c.json({ items: [], nextCursor: null, hidden: 0, cappedAt: cap });
  // A collection is someone's page: its owner's notes show to whoever they share notes with, signed out included (lib/notes.ts).
  const pageOwnerId = collectionId
    ? Number((await db.execute<{ userId: string }>(sql`select user_id as "userId" from collections where id = ${collectionId}`)).rows[0]?.userId ?? 0) || null
    : null;

  let cursorClause = sql``;
  if (before) {
    const [ts, id] = before.split("|");
    cursorClause = sql`and (i.published_at, i.id) < (${ts}::timestamptz, ${Number(id)}::bigint)`;
  }
  // A collection is readable if it is mine, or if its owner shows it: public profile, collections shown, collection public.
  const readable = sql`(col.user_id = ${userId} or exists(
    select 1 from users u where u.id = col.user_id and u.profile_visibility = 'public' and u.collections_visibility = 'public' and col.is_public and col.parent_id is not null))`;
  // A single feed's river ignores collections entirely: you can read a feed you don't follow.
  const scope = feedId
    ? sql`with tree as (select null::bigint as id where false)`
    : collectionId
    ? sql`with recursive tree as (select col.id from collections col where col.id = ${collectionId} and ${readable} union all select c.id from collections c join tree t on c.parent_id = t.id join collections p on p.id = t.id where p.parent_id is not null and (c.is_public or c.user_id = ${userId}))`
    : sql`with tree as (select id from collections where user_id = ${userId})`;

  /**
   * Feeds and items are global, so "my river" is a merge across the feeds I
   * follow. The obvious way — walk the global published_at index backwards and
   * throw away everyone else's feeds — costs the whole instance's posting rate
   * divided by my share of it. That is unbounded, and it is worst for the
   * person following least, which is what every new account looks like.
   *
   * So: take each followed feed's newest page from items_feed_published_id_idx
   * and merge them. Any item in the global newest N must be in its own feed's
   * newest N, so the merge is exact, and the cost becomes proportional to how
   * many feeds *I* follow rather than how big the instance is — flat forever.
   *
   * Measured on the alpha at 14,583 items, 2026-09-13: following 2 of 680 feeds
   * went from 13,166 buffers (~103 MB) and 8.4 ms to 256 buffers and 0.40 ms.
   * Following 648 went the other way, 47 buffers to 2,564 — about four buffers
   * per followed feed, which is one btree descent each and the floor for this
   * shape. That is the trade on purpose: an unbounded cost became a bounded one.
   *
   * A single feed's river needs none of it; that was always one index scan.
   *
   * Hidden Shorts are filtered inside each feed's scan, before its limit, so a
   * page is still a full page. The setting rides along on `followed` so the
   * scan checks a column rather than looking the setting up per item.
   */
  const perFeed = limit + 1;
  const pageCte = feedId
    ? sql`select i.id, i.published_at from items i where i.feed_id = ${feedId} ${cursorClause}
             and not (${isShort} and ${hidesShorts(userId, sql`i.feed_id`)})
           order by i.published_at desc, i.id desc limit ${perFeed}`
    : sql`select p.id, p.published_at from followed cross join lateral (
             select i.id, i.published_at from items i
             where i.feed_id = followed.feed_id ${cursorClause}
               and not (followed.hide_shorts and ${isShort})
             order by i.published_at desc, i.id desc limit ${perFeed}
           ) p
           order by p.published_at desc, p.id desc limit ${perFeed}`;

  const rows = await db.execute<RiverItem & { blocked: boolean }>(sql`
    ${scope}
    , followed as (
      select cf.feed_id, bool_or(coalesce(fs.hide_shorts, ${shortsDefault(userId)})) as hide_shorts
      from collection_feeds cf join tree on tree.id = cf.collection_id
      left join feed_settings fs on fs.user_id = ${userId} and fs.feed_id = cf.feed_id
      group by cf.feed_id
    )
    , page as (${pageCte})
    select i.id, i.feed_id as "feedId", coalesce(fs.display_name, f.title) as "feedTitle", f.site_url as "siteUrl",
           ${feedSlugSql} as "feedSlug",
           i.url, i.title, i.author, i.summary, i.image_url as "imageUrl", i.published_at as "publishedAt",
           exists(select 1 from blocks b where b.user_id = ${userId} and b.feed_id = i.feed_id) as blocked,
           exists(select 1 from feed_icons fi where fi.feed_id = i.feed_id and not fi.generic) as "hasIcon",
           (select bm.id from bookmarks bm where bm.user_id = ${userId} and bm.item_id = i.id limit 1) as "bookmarkId",
           (select coalesce(json_agg(json_build_object('id', o.id, 'publishedAt', o.published_at, 'url', o.url, 'title', o.title) order by o.published_at desc), '[]'::json)
              from (select o.id, o.published_at, o.url, o.title from item_repeats r join items o on o.id = r.of_item_id
                    where r.item_id = i.id order by o.published_at desc limit 5) o) as "repeatOf",
           ${noteColumns(userId, pageOwnerId)}
    from page
    join items i on i.id = page.id
    join feeds f on f.id = i.feed_id
    left join feed_settings fs on fs.user_id = ${userId} and fs.feed_id = i.feed_id
    order by i.published_at desc, i.id desc
  `);
  const all = rows.rows;
  const hidden = all.filter((r) => r.blocked).length;
  const visible = all.filter((r) => !r.blocked);
  const page = visible.slice(0, limit);
  const last = all.length > limit ? all[limit - 1] : null;
  const nextCursor = last ? `${new Date(last.publishedAt).toISOString()}|${last.id}` : null;
  return c.json({
    items: page.map(({ blocked, ...r }) => ({ ...r, publishedAt: new Date(r.publishedAt).toISOString() })),
    nextCursor: cap ? null : nextCursor, hidden,
    cappedAt: cap && last ? cap : null,
  });
});
