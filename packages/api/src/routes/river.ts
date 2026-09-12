/**
 * The river: everything the user follows, newest first, keyset-paginated.
 * Optional ?collection=<id> scopes to that collection's subtree.
 * Blocked feeds are excluded and the count of hidden items is reported, so the
 * UI can say "N posts hidden by your blocks" without saying which.
 */
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { currentUser } from "../lib/user.js";
import { noteColumns } from "../lib/notes.js";

export const river = new Hono();

export type RiverItem = {
  id: number; feedId: number; feedTitle: string | null; siteUrl: string | null;
  url: string | null; title: string | null; author: string | null; summary: string | null;
  imageUrl: string | null; publishedAt: string; hasIcon: boolean; bookmarkId: number | null;
  myNote: { id: number; body: string; createdAt: string; updatedAt: string } | null;
  notes: { id: number; body: string; createdAt: string; updatedAt: string; author: { handle: string; displayName: string | null } }[];
};

/** The numbers under "All my feeds": what you follow, and what arrived in the last day. */
river.get("/stats", async (c) => {
  const user = currentUser(c);
  const [row] = (await db.execute<{ feeds: number; collections: number; posts24h: number; feeds24h: number }>(sql`
    with followed as (select distinct cf.feed_id from collection_feeds cf join collections col on col.id = cf.collection_id where col.user_id = ${user.id}),
         fresh as (select i.feed_id from items i join followed on followed.feed_id = i.feed_id
                   where i.published_at > now() - interval '24 hours' and i.published_at <= now() + interval '1 hour'
                     and not exists(select 1 from blocks b where b.user_id = ${user.id} and b.feed_id = i.feed_id))
    select (select count(*)::int from followed) as feeds,
           (select count(*)::int from collections where user_id = ${user.id} and parent_id is not null) as collections,
           (select count(*)::int from fresh) as "posts24h",
           (select count(distinct feed_id)::int from fresh) as "feeds24h"
  `)).rows;
  return c.json(row);
});

river.get("/", async (c) => {
  const limit = Math.min(100, Math.max(1, Number(c.req.query("limit") ?? 40)));
  const before = c.req.query("before"); // "<iso>|<id>" cursor
  const collectionId = c.req.query("collection") ? Number(c.req.query("collection")) : null;
  const feedId = c.req.query("feed") ? Number(c.req.query("feed")) : null;
  // "Everything" is mine and needs me signed in. A single feed or a public
  // collection can be read by anyone; bookmark/block columns just come back empty.
  const user = feedId || collectionId ? c.get("user") : currentUser(c);
  const userId = user?.id ?? -1;

  let cursorClause = sql``;
  if (before) {
    const [ts, id] = before.split("|");
    cursorClause = sql`and (i.published_at, i.id) < (${ts}::timestamptz, ${Number(id)}::bigint)`;
  }
  // A collection is readable if it is mine, or if its owner shows it: public profile, collections shown, collection public.
  const readable = sql`(col.user_id = ${userId} or exists(
    select 1 from users u where u.id = col.user_id and u.profile_visibility = 'public' and u.show_collections and col.is_public and col.parent_id is not null))`;
  // A single feed's river ignores collections entirely: you can read a feed you don't follow.
  const scope = feedId
    ? sql`with tree as (select null::bigint as id where false)`
    : collectionId
    ? sql`with recursive tree as (select col.id from collections col where col.id = ${collectionId} and ${readable} union all select c.id from collections c join tree t on c.parent_id = t.id join collections p on p.id = t.id where p.parent_id is not null and (c.is_public or c.user_id = ${userId}))`
    : sql`with tree as (select id from collections where user_id = ${userId})`;

  const rows = await db.execute<RiverItem & { blocked: boolean }>(sql`
    ${scope}
    , followed as (
      select distinct cf.feed_id from collection_feeds cf join tree on tree.id = cf.collection_id
    )
    select i.id, i.feed_id as "feedId", f.title as "feedTitle", f.site_url as "siteUrl",
           i.url, i.title, i.author, i.summary, i.image_url as "imageUrl", i.published_at as "publishedAt",
           exists(select 1 from blocks b where b.user_id = ${userId} and b.feed_id = i.feed_id) as blocked,
           exists(select 1 from feed_icons fi where fi.feed_id = i.feed_id and not fi.generic) as "hasIcon",
           (select bm.id from bookmarks bm where bm.user_id = ${userId} and bm.item_id = i.id limit 1) as "bookmarkId",
           ${noteColumns(userId)}
    from items i
    join feeds f on f.id = i.feed_id
    where ${feedId ? sql`i.feed_id = ${feedId}` : sql`i.feed_id in (select feed_id from followed)`}
    ${cursorClause}
    order by i.published_at desc, i.id desc
    limit ${limit + 1}
  `);
  const all = rows.rows;
  const hidden = all.filter((r) => r.blocked).length;
  const visible = all.filter((r) => !r.blocked);
  const page = visible.slice(0, limit);
  const last = all.length > limit ? all[limit - 1] : null;
  const nextCursor = last ? `${new Date(last.publishedAt).toISOString()}|${last.id}` : null;
  return c.json({ items: page.map(({ blocked, ...r }) => ({ ...r, publishedAt: new Date(r.publishedAt).toISOString() })), nextCursor, hidden });
});
