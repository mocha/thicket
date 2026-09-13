/**
 * What a visitor can see before signing up. Today: a handful of public
 * collections on this instance, for the homepage's "peek inside" strip.
 * Same visibility rules as profiles: public profile, collections shown,
 * collection public, and it has to have something in it.
 */
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { getSetting } from "../lib/instance.js";

export const explore = new Hono();

explore.get("/collections", async (c) => {
  const viewer = c.get("user");
  const viewerId = viewer?.id ?? -1;
  const q = (c.req.query("q") ?? "").trim();
  const network = c.req.query("network") === "1"; // only collections by people I follow
  const limit = Math.min(50, Math.max(1, Number(c.req.query("limit") ?? 6)));
  const offset = Math.max(0, Number(c.req.query("offset") ?? 0));
  // Never my own, and never one I already copied: both are already on my shelf.
  const where = [sql`col.parent_id is not null and col.is_public and u.profile_visibility = 'public' and u.collections_visibility = 'public'
      and exists(select 1 from collection_feeds cf where cf.collection_id = col.id) and col.user_id <> ${viewerId}
      and not exists(select 1 from collections mine where mine.user_id = ${viewerId} and mine.copied_from_id = col.id)`];
  if (q) {
    const like = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`;
    where.push(sql`(col.name ilike ${like} or col.description ilike ${like})`);
  }
  if (network) where.push(sql`exists(select 1 from user_follows uf where uf.follower_id = ${viewerId} and uf.followee_id = col.user_id)`);
  const [{ total }] = (await db.execute<{ total: number }>(sql`select count(*)::int as total from collections col join users u on u.id = col.user_id where ${sql.join(where, sql` and `)}`)).rows;
  const [{ indexTotal }] = (await db.execute<{ indexTotal: number }>(sql`select count(*)::int as "indexTotal" from collections col join users u on u.id = col.user_id where ${where[0]}`)).rows;
  const rows = await db.execute(sql`
    select col.id, col.name, col.slug, col.description, u.handle, u.display_name as "displayName",
           (select count(*)::int from collection_feeds cf where cf.collection_id = col.id) as "feedCount",
           (select coalesce(json_agg(x), '[]'::json) from (
              select f.id, coalesce(cf.title_override, f.title) as title,
                     exists(select 1 from feed_icons fi where fi.feed_id = f.id and not fi.generic) as "hasIcon"
              from collection_feeds cf join feeds f on f.id = cf.feed_id
              where cf.collection_id = col.id order by f.last_item_at desc nulls last limit 4) x) as sample
    from collections col join users u on u.id = col.user_id
    where ${sql.join(where, sql` and `)}
    order by "feedCount" desc, col.created_at desc limit ${limit + 1} offset ${offset}
  `);
  // The answer depends on who is asking, so a shared cache must key on the cookie.
  c.header("vary", "cookie");
  if (!viewer && !q) c.header("cache-control", "public, max-age=120");
  const page = rows.rows.slice(0, limit);
  return c.json({ collections: page.map((r: any) => ({ ...r, id: Number(r.id) })), total, indexTotal, nextOffset: rows.rows.length > limit ? offset + limit : null });
});

/**
 * Starter packs: the collections this instance puts in front of someone who
 * has just arrived and follows nothing yet.
 *
 * These are one ordinary account's public collections — the handle is stored
 * in instance_settings as `starter_account`. Nothing about that account is
 * special: an admin curates it by signing in and making collections the way
 * anyone else does, it has a profile you can visit, and it can keep notes and
 * bookmarks that show what the thing looks like in use. A separate "featured"
 * list would have been a second place to keep the same information.
 *
 * When no account is named, or the named one has gone private, this falls back
 * to the fullest public collections on the instance so a newcomer always has
 * somewhere to start. The `from` field says which of the two happened.
 *
 * Public on purpose: the sign-up page shows these before anyone has an
 * account, so "here, copy mine" works as a link you can send to a friend.
 */
explore.get("/featured", async (c) => {
  const viewer = c.get("user");
  const viewerId = viewer?.id ?? -1;
  const handle = ((await getSetting<string>("starter_account")) ?? "").trim().toLowerCase();
  const visible = sql`col.parent_id is not null and col.is_public and u.profile_visibility = 'public'
    and u.collections_visibility = 'public' and exists(select 1 from collection_feeds cf where cf.collection_id = col.id)`;
  const curated = handle
    ? (await db.execute<{ id: number }>(sql`select id from users where handle = ${handle} and profile_visibility = 'public' and collections_visibility = 'public'`)).rows[0]
    : undefined;
  const where = sql`${visible} and col.user_id <> ${viewerId} ${curated ? sql`and col.user_id = ${curated.id}` : sql``}`;
  // A curated account's order is the order it built them in, so the curator
  // controls what leads by adding in the order they want — no separate ranking
  // to keep in sync. Left to size, the biggest collection wins, and the biggest
  // is exactly the firehose a newcomer should not be handed first.
  const order = curated ? sql`col.created_at, col.name` : sql`"feedCount" desc, col.name`;
  const rows = await db.execute(sql`
    select col.id, col.name, col.slug, col.description, u.handle, u.display_name as "displayName",
           col.user_id = ${viewerId} as "isMine",
           (select count(*)::int from collection_feeds cf where cf.collection_id = col.id) as "feedCount",
           (select coalesce(json_agg(x), '[]'::json) from (
              select f.id, coalesce(cf.title_override, f.title) as title,
                     exists(select 1 from feed_icons fi where fi.feed_id = f.id and not fi.generic) as "hasIcon"
              from collection_feeds cf join feeds f on f.id = cf.feed_id
              where cf.collection_id = col.id order by f.last_item_at desc nulls last limit 5) x) as sample
    from collections col join users u on u.id = col.user_id
    where ${where}
    order by ${order} limit 6
  `);
  c.header("vary", "cookie");
  if (!viewer) c.header("cache-control", "public, max-age=300");
  return c.json({
    from: curated ? handle : null,
    collections: rows.rows.map((r: any) => ({ ...r, id: Number(r.id) })),
  });
});

/**
 * People with public profiles, searchable by handle, name and bio. Signed-in
 * only (this is for following, and a visitor has the homepage). Never the
 * viewer themself. Follower counts are deliberately absent: no vanity metric.
 */
explore.get("/users", async (c) => {
  const viewer = c.get("user");
  if (!viewer) return c.json({ error: "sign in required" }, 401);
  const q = (c.req.query("q") ?? "").trim();
  const limit = Math.min(50, Math.max(1, Number(c.req.query("limit") ?? 30)));
  const offset = Math.max(0, Number(c.req.query("offset") ?? 0));
  const where = [sql`u.profile_visibility = 'public' and u.id <> ${viewer.id}`];
  if (q) {
    const like = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`;
    where.push(sql`(u.handle ilike ${like} or u.display_name ilike ${like} or u.bio ilike ${like})`);
  }
  const [{ total }] = (await db.execute<{ total: number }>(sql`select count(*)::int as total from users u where ${sql.join(where, sql` and `)}`)).rows;
  const [{ indexTotal }] = (await db.execute<{ indexTotal: number }>(sql`select count(*)::int as "indexTotal" from users u where ${where[0]}`)).rows;
  const rows = await db.execute(sql`
    select u.handle, u.display_name as "displayName", u.bio, u.created_at as "createdAt",
           (select count(distinct cf.feed_id)::int from collection_feeds cf join collections col on col.id = cf.collection_id where col.user_id = u.id) as feeds,
           (select count(*)::int from collections col where col.user_id = u.id and col.parent_id is not null and col.is_public and u.collections_visibility = 'public') as collections,
           case when u.notes_visibility = 'public' then (select count(*)::int from notes n where n.user_id = u.id) else null end as notes,
           exists(select 1 from user_follows uf where uf.follower_id = ${viewer.id} and uf.followee_id = u.id) as "isFollowing"
    from users u where ${sql.join(where, sql` and `)}
    order by "isFollowing" desc, lower(coalesce(u.display_name, u.handle)) limit ${limit + 1} offset ${offset}
  `);
  const page = rows.rows.slice(0, limit);
  return c.json({ users: page.map((r: any) => ({ ...r, createdAt: new Date(r.createdAt).toISOString() })), total, indexTotal, nextOffset: rows.rows.length > limit ? offset + limit : null });
});
