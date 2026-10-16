/**
 * Explore's browse lists, for when nothing is typed: public collections and
 * people on this instance (feeds browse at /api/feeds, and anything with words
 * goes to /api/search). The collections list is also what a visitor can see
 * before signing up, and starter packs are what a newcomer is handed first.
 *
 * Collections follow the same visibility rules as profiles: public profile,
 * collections shown, collection public, and it has to have something in it.
 *
 * Both lists take the filters every Explore list takes: network=1 ("People I
 * follow") and since=24h|week|month|year (lib/since.ts),
 * and their own sort=.
 */
import { Hono } from "hono";
import { sql, type SQL } from "drizzle-orm";
import { collectionSample } from "../lib/subtree.js";
import { db } from "../db/client.js";
import { getSetting } from "../lib/instance.js";
import { notARepeatOf } from "../lib/visibility.js";
import { sinceIntervalFrom, sinceSql } from "../lib/since.js";
import { oneOf } from "../lib/one-of.js";

export const explore = new Hono();

/**
 * The orders the collections browse list can take. "feeds" (the biggest first,
 * newest first among equals) is the default because it is the order this list
 * has always had; "newest" is the newest made; "name" is A to Z.
 */
export const BROWSE_COLLECTION_SORTS = ["feeds", "newest", "name"] as const;
export type BrowseCollectionSort = (typeof BROWSE_COLLECTION_SORTS)[number];
export const DEFAULT_BROWSE_COLLECTION_SORT: BrowseCollectionSort = "feeds";
export const browseCollectionSortFrom = oneOf(BROWSE_COLLECTION_SORTS, DEFAULT_BROWSE_COLLECTION_SORT);
const BROWSE_COLLECTION_ORDER: Record<BrowseCollectionSort, SQL> = {
  feeds: sql`"feedCount" desc, col.created_at desc`,
  newest: sql`col.created_at desc, col.id desc`,
  name: sql`lower(col.name), col.id`,
};

/**
 * GET /api/explore/collections?q=&network=&since=&sort=&offset=&limit=
 *
 * `total` counts what the filters leave.
 */
explore.get("/collections", async (c) => {
  const viewer = c.get("user");
  const viewerId = viewer?.id ?? -1;
  const q = (c.req.query("q") ?? "").trim();
  const network = c.req.query("network") === "1"; // only collections by people I follow
  const since = sinceIntervalFrom(c.req.query("since")); // only collections made in the window
  const sort = browseCollectionSortFrom(c.req.query("sort"));
  const limit = Math.min(50, Math.max(1, Number(c.req.query("limit") ?? 6)));
  const offset = Math.max(0, Number(c.req.query("offset") ?? 0));
  const filters = [sql`col.parent_id is not null and col.visibility = 'public' and u.profile_visibility = 'public' and u.collections_visibility = 'public'
      and exists(select 1 from collection_feeds cf where cf.collection_id = col.id)`];
  if (q) {
    const like = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`;
    filters.push(sql`(col.name ilike ${like} or col.description ilike ${like})`);
  }
  if (network) filters.push(sql`exists(select 1 from user_follows uf where uf.follower_id = ${viewerId} and uf.followee_id = col.user_id)`);
  if (since) filters.push(sinceSql("col.created_at", since));
  /**
   * What the list shows, as `shown(id)`. Everything that passes the filters,
   * then two things left out:
   *  - what's already on my shelf: my own, one I copied, or a copy of either
   *  - a repeat: a copy whose original or earlier copy is also in this list
   * Repeats are judged after the filters, so a copy never steps aside for an
   * original the filters then drop.
   */
  const shown = (where: SQL[]) => sql`
    with listed as (
      select col.id, col.copied_from_id, col.user_id from collections col join users u on u.id = col.user_id
      where ${sql.join(where, sql` and `)}
    ), shelf as (select id, copied_from_id from collections where user_id = ${viewerId})
    , shown as (
      select l.id from listed l
      where l.user_id <> ${viewerId}
        and not exists(select 1 from shelf m where m.copied_from_id = l.id or m.id = l.copied_from_id or m.copied_from_id = l.copied_from_id)
        and ${notARepeatOf("l", "listed")}
    )`;
  const [{ total }] = (await db.execute<{ total: number }>(sql`${shown(filters)} select count(*)::int as total from shown`)).rows;
  const rows = await db.execute(sql`
    ${shown(filters)}
    select col.id, col.name, col.slug, col.description, u.handle, u.display_name as "displayName",
           col.feed_count as "feedCount",
           ${collectionSample(sql`col.id`, 4)} as sample
    from collections col join users u on u.id = col.user_id
    where col.id in (select id from shown)
    order by ${BROWSE_COLLECTION_ORDER[sort]} limit ${limit + 1} offset ${offset}
  `);
  // The answer depends on who is asking, so a shared cache must key on the cookie.
  c.header("vary", "cookie");
  if (!viewer && !q) c.header("cache-control", "public, max-age=120");
  const page = rows.rows.slice(0, limit);
  return c.json({ collections: page.map((r: any) => ({ ...r, id: Number(r.id) })), sort, total, nextOffset: rows.rows.length > limit ? offset + limit : null });
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
 *
 * With an account named, the admin can tick which of its collections are
 * offered (`starter_collections`, a list of ids). Until they do, it's the
 * first six the account made.
 *
 * `viewerId`'s own collections are left out, since they can't copy their
 * own. Admin's preview asks with no viewer, so it shows exactly what a
 * brand-new account gets.
 */
export async function featuredCollections(viewerId: number) {
  const handle = ((await getSetting<string>("starter_account")) ?? "").trim().toLowerCase();
  const visible = sql`col.parent_id is not null and col.visibility = 'public' and u.profile_visibility = 'public'
    and u.collections_visibility = 'public' and exists(select 1 from collection_feeds cf where cf.collection_id = col.id)`;
  const curated = handle
    ? (await db.execute<{ id: number }>(sql`select id from users where handle = ${handle} and profile_visibility = 'public' and collections_visibility = 'public'`)).rows[0]
    : undefined;
  // Ticked by the admin: only those, however many. Never ticked: the first six.
  const picked = curated ? await getSetting<number[]>("starter_collections") : null;
  const ids = Array.isArray(picked) ? picked.map(Number).filter(Number.isFinite) : null;
  const only = ids ? (ids.length ? sql`and col.id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})` : sql`and false`) : sql``;
  const where = sql`${visible} and col.user_id <> ${viewerId} ${curated ? sql`and col.user_id = ${curated.id} ${only}` : sql``}`;
  // A curated account's order is the order it built them in, so the curator
  // controls what leads by adding in the order they want — no separate ranking
  // to keep in sync. Left to size, the biggest collection wins, and the biggest
  // is exactly the firehose a newcomer should not be handed first.
  const order = curated ? sql`col.created_at, col.name` : sql`"feedCount" desc, col.name`;
  const rows = await db.execute(sql`
    select col.id, col.name, col.slug, col.description, u.handle, u.display_name as "displayName",
           col.user_id = ${viewerId} as "isMine",
           col.feed_count as "feedCount",
           ${collectionSample(sql`col.id`, 5)} as sample
    from collections col join users u on u.id = col.user_id
    where ${where}
    order by ${order} limit ${ids ? 100 : 6}
  `);
  return { from: curated ? handle : null, collections: rows.rows.map((r: any) => ({ ...r, id: Number(r.id) })) };
}

explore.get("/featured", async (c) => {
  const viewer = c.get("user");
  const featured = await featuredCollections(viewer?.id ?? -1);
  c.header("vary", "cookie");
  if (!viewer) c.header("cache-control", "public, max-age=300");
  return c.json(featured);
});

/**
 * The orders the people browse list can take. "name" is the default: A to Z
 * by the name people go by, the same as a searched list's "name", with nobody
 * moved up for being followed (Show: People I follow narrows to them instead).
 * "newest" is the newest to join. Never most followed: see below.
 */
export const BROWSE_PEOPLE_SORTS = ["name", "newest"] as const;
export type BrowsePeopleSort = (typeof BROWSE_PEOPLE_SORTS)[number];
export const DEFAULT_BROWSE_PEOPLE_SORT: BrowsePeopleSort = "name";
export const browsePeopleSortFrom = oneOf(BROWSE_PEOPLE_SORTS, DEFAULT_BROWSE_PEOPLE_SORT);
const BROWSE_PEOPLE_ORDER: Record<BrowsePeopleSort, SQL> = {
  name: sql`lower(coalesce(u.display_name, u.handle)), u.handle`,
  newest: sql`u.created_at desc, u.id desc`,
};

/**
 * GET /api/explore/users?q=&network=&since=&sort=&offset=&limit=
 *
 * People with public profiles, searchable by handle, name and bio. Signed-in
 * only (this is for following, and a visitor has the homepage). Never the
 * viewer themself. network=1 keeps only people the viewer follows; since= keeps
 * people who joined in the window. `total` counts what the filters leave.
 * Follower counts are deliberately absent: no vanity metric.
 */
explore.get("/users", async (c) => {
  const viewer = c.get("user");
  if (!viewer) return c.json({ error: "sign in required" }, 401);
  const q = (c.req.query("q") ?? "").trim();
  const network = c.req.query("network") === "1";
  const since = sinceIntervalFrom(c.req.query("since"));
  const sort = browsePeopleSortFrom(c.req.query("sort"));
  const limit = Math.min(50, Math.max(1, Number(c.req.query("limit") ?? 30)));
  const offset = Math.max(0, Number(c.req.query("offset") ?? 0));
  const where = [sql`u.profile_visibility = 'public' and u.id <> ${viewer.id}`];
  if (q) {
    const like = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`;
    where.push(sql`(u.handle ilike ${like} or u.display_name ilike ${like} or u.bio ilike ${like})`);
  }
  if (network) where.push(sql`exists(select 1 from user_follows uf where uf.follower_id = ${viewer.id} and uf.followee_id = u.id)`);
  if (since) where.push(sinceSql("u.created_at", since));
  const [{ total }] = (await db.execute<{ total: number }>(sql`select count(*)::int as total from users u where ${sql.join(where, sql` and `)}`)).rows;
  const rows = await db.execute(sql`
    select u.handle, u.display_name as "displayName", u.bio, u.created_at as "createdAt",
           (select ua.updated_at from user_avatars ua where ua.user_id = u.id) as "avatarUpdatedAt",
           (select count(distinct cf.feed_id)::int from collection_feeds cf join collections col on col.id = cf.collection_id where col.user_id = u.id) as feeds,
           (select count(*)::int from collections col where col.user_id = u.id and col.parent_id is not null and col.visibility = 'public' and u.collections_visibility = 'public') as collections,
           case when u.notes_visibility = 'public' then (select count(*)::int from bookmarks n where n.user_id = u.id and n.note is not null) else null end as notes,
           exists(select 1 from user_follows uf where uf.follower_id = ${viewer.id} and uf.followee_id = u.id) as "isFollowing"
    from users u where ${sql.join(where, sql` and `)}
    order by ${BROWSE_PEOPLE_ORDER[sort]} limit ${limit + 1} offset ${offset}
  `);
  const page = rows.rows.slice(0, limit);
  return c.json({ users: page.map((r: any) => ({ ...r, createdAt: new Date(r.createdAt).toISOString() })), sort, total, nextOffset: rows.rows.length > limit ? offset + limit : null });
});
