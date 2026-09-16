/**
 * What's new: for each of my collections, how many posts are newer than a
 * point this device remembers, and how busy the collection is.
 *
 * The device keeps the point (lib/marks.svelte.ts in the web app): the newest
 * post the reader has actually scrolled or paged past in that collection. It
 * sends those points here and gets counts back. Nothing is stored: the server
 * learns "this browser has seen up to Tuesday 14:02 in News" for the length of
 * one request, and never which posts anyone read. That is the whole record.
 *
 * Counts stop at 101 so a point nobody has moved for a month costs a bounded
 * scan, and use the per-feed index the river uses, so the cost follows the
 * feeds I follow rather than the size of the instance (measured 2026-09-15:
 * 1.2 ms for 650 feeds across 14 collections). `weekly` is the collection's
 * posts in the last seven days, which is what lets the sidebar show a quiet
 * collection's exact number and a firehose's mere dot.
 */
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { currentUser } from "../lib/user.js";
import { isShort, shortsDefault } from "./river.js";

export const marks = new Hono();

export type Mark = { collectionId: number; count: number; more: boolean; weekly: number };

/** Past this the sidebar says "100+" and the scan stops. */
const CAP = 100;

marks.post("/counts", async (c) => {
  const user = currentUser(c);
  const body = await c.req.json<{ anchors?: Record<string, string> }>().catch(() => ({} as { anchors?: Record<string, string> }));
  const pairs: { id: number; at: string }[] = [];
  for (const [k, v] of Object.entries(body.anchors ?? {})) {
    const id = Number(k);
    const at = new Date(v);
    if (!Number.isFinite(id) || Number.isNaN(at.getTime())) continue;
    pairs.push({ id, at: at.toISOString() });
  }
  // One JSON parameter rather than two arrays: the sql tag would spell an array out as a row.
  const anchorsJson = JSON.stringify(pairs);
  const rows = await db.execute<{ collectionId: number; count: number; more: boolean; weekly: number }>(sql`
    with recursive cols as (
      select id, parent_id from collections where user_id = ${user.id}
    ), tree as (
      select id as root, id as node from cols
      union all
      select t.root, c.id from tree t join cols c on c.parent_id = t.node
    ), anchors as (
      select (e->>'id')::bigint as id, (e->>'at')::timestamptz as at from jsonb_array_elements(${anchorsJson}::jsonb) e
    ), followed as (
      select t.root, cf.feed_id, bool_or(coalesce(fs.hide_shorts, ${shortsDefault(user.id)})) as hide_shorts
      from tree t
      join collection_feeds cf on cf.collection_id = t.node
      left join feed_settings fs on fs.user_id = ${user.id} and fs.feed_id = cf.feed_id
      where not exists (select 1 from blocks b where b.user_id = ${user.id} and b.feed_id = cf.feed_id)
      group by t.root, cf.feed_id
    )
    select c.id as "collectionId", coalesce(n.count, 0) as count, coalesce(n.count, 0) > ${CAP} as more, w.weekly
    from cols c
    left join anchors a on a.id = c.id
    cross join lateral (
      select count(*)::int as weekly from followed f join items i on i.feed_id = f.feed_id
      where f.root = c.id and i.published_at > now() - interval '7 days' and not (f.hide_shorts and ${isShort})
    ) w
    left join lateral (
      select count(*)::int as count from (
        select 1 from followed f join items i on i.feed_id = f.feed_id
        where f.root = c.id and i.published_at > a.at and not (f.hide_shorts and ${isShort})
        limit ${CAP + 1}
      ) x
    ) n on a.id is not null
  `);
  return c.json({
    marks: rows.rows.map((r) => ({ collectionId: Number(r.collectionId), count: Math.min(r.count, CAP), more: r.more, weekly: r.weekly })),
  });
});
