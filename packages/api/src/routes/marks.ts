/**
 * What's new: how many posts have arrived in each of my collections since I
 * last opened it. One mark per person per collection (collection_marks); a
 * collection with no mark counts from its own creation. Counts are capped at
 * 100, so a mark nobody has moved for a month costs a bounded scan, and they
 * use the per-feed index the river does, so the cost follows the feeds I
 * follow rather than the size of the instance (measured 2026-09-15: 1.2 ms
 * for 650 feeds across 14 collections).
 *
 * The client only calls either endpoint from a device where the option is on.
 * Nothing is kept per post or per feed.
 */
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { currentUser } from "../lib/user.js";
import { isShort, shortsDefault } from "./river.js";

export const marks = new Hono();

export type Mark = { collectionId: number; since: string; count: number; more: boolean };

/** The cap: past this the sidebar says "100+" and the scan stops. */
const CAP = 100;

marks.get("/", async (c) => {
  const user = currentUser(c);
  const rows = await db.execute<{ collectionId: number; since: string; count: number; more: boolean }>(sql`
    with recursive cols as (
      select id, parent_id, created_at from collections where user_id = ${user.id}
    ), tree as (
      select id as root, id as node from cols
      union all
      select t.root, c.id from tree t join cols c on c.parent_id = t.node
    ), since as (
      select c.id, coalesce(m.seen_at, c.created_at) as since
      from cols c left join collection_marks m on m.user_id = ${user.id} and m.collection_id = c.id
    ), followed as (
      select t.root, cf.feed_id, bool_or(coalesce(fs.hide_shorts, ${shortsDefault(user.id)})) as hide_shorts
      from tree t
      join collection_feeds cf on cf.collection_id = t.node
      left join feed_settings fs on fs.user_id = ${user.id} and fs.feed_id = cf.feed_id
      where not exists (select 1 from blocks b where b.user_id = ${user.id} and b.feed_id = cf.feed_id)
      group by t.root, cf.feed_id
    )
    select s.id as "collectionId", s.since, n.count, n.count > ${CAP} as more
    from since s cross join lateral (
      select count(*)::int as count from (
        select 1 from followed f join items i on i.feed_id = f.feed_id
        where f.root = s.id and i.published_at > s.since and not (f.hide_shorts and ${isShort})
        limit ${CAP + 1}
      ) x
    ) n
  `);
  return c.json({
    marks: rows.rows.map((r) => ({ collectionId: Number(r.collectionId), since: new Date(r.since).toISOString(), count: Math.min(r.count, CAP), more: r.more })),
  });
});

/**
 * "I have just looked at this collection." The mark moves to the newest post
 * that was on screen, never backwards, and never into the future; the next
 * count starts from there. Only my own collections have marks.
 */
marks.put("/:id", async (c) => {
  const user = currentUser(c);
  const id = Number(c.req.param("id"));
  const body = await c.req.json<{ seenAt?: string }>().catch(() => ({} as { seenAt?: string }));
  const at = body.seenAt ? new Date(body.seenAt) : new Date();
  if (!Number.isFinite(id) || Number.isNaN(at.getTime())) return c.json({ error: "bad request" }, 400);
  const seenAt = at.getTime() > Date.now() ? new Date() : at;
  const rows = await db.execute<{ since: string }>(sql`
    insert into collection_marks (user_id, collection_id, seen_at)
    select ${user.id}, id, ${seenAt.toISOString()}::timestamptz from collections where id = ${id} and user_id = ${user.id}
    on conflict (user_id, collection_id) do update set seen_at = greatest(collection_marks.seen_at, excluded.seen_at)
    returning seen_at as since
  `);
  const row = rows.rows[0];
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json({ collectionId: id, since: new Date(row.since).toISOString() });
});
