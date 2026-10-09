/**
 * Updates from a collection I copied (issue #52).
 *
 * **Nothing is tracked.** Turning updates on for a copy (collections.follows_original)
 * records nothing about the original or what its owner does with it. The copy
 * is compared to the original when someone looks: the feeds anywhere in the
 * original, as far as I may see it, that are nowhere in my copy are what it has
 * that I don't. A feed its owner added and took away again was never seen, and
 * nothing says when they removed one.
 *
 * **Flattened.** Where a feed sits inside either tree doesn't matter, only
 * whether it's in it. What I take lands at the top of my copy, so this works the
 * same for a copy kept as a tree and one flattened into a single collection.
 *
 * **What I passed on.** The one thing kept is about my copy: the feeds I have
 * seen in the original and chosen not to take (copy_ignored_feeds). Unticked
 * when reviewing, or removed from my copy while the original still has them
 * (`rememberRemoved`). They are still listed, after the new ones and unticked,
 * but no longer counted as new. Turning updates off deletes the list.
 */
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { feedSlugSql } from "./slug.js";
import { allows, allowedLevelsSql, isFriendOf, type Audience, type ShareLevel } from "./visibility.js";

/** A list of ids as one bigint[] parameter (as feeds/repeats.ts does). */
const idArray = (ids: number[]) => sql`${`{${ids.map((id) => Math.trunc(id)).join(",")}}`}::bigint[]`;

type OwnerRow = {
  ownerId: number; handle: string; displayName: string | null; avatarUpdatedAt: Date | null;
  profileVisibility: "public" | "private"; collectionsVisibility: ShareLevel;
};

/** The original of one of my copies, while I may still see it. */
export type Original = {
  id: number; name: string; slug: string; visibility: ShareLevel;
  owner: { id: number; handle: string; displayName: string | null; avatarUpdatedAt: string | null };
  /** What I am to its owner: decides which of its sub-collections I see. */
  who: Audience;
};

/**
 * The collection my copy `copyId` was copied from, when I can still see it: its
 * owner's profile isn't private, shares collections with me, and the
 * collection itself is shared with me. Otherwise null, the same as never copied.
 */
export async function originalOf(copyId: number, meId: number): Promise<Original | null> {
  const [src] = (await db.execute<OwnerRow & { id: number; name: string; slug: string; visibility: ShareLevel }>(sql`
    select src.id, src.name, src.slug, src.visibility, u.id as "ownerId", u.handle, u.display_name as "displayName",
           ua.updated_at as "avatarUpdatedAt", u.profile_visibility as "profileVisibility", u.collections_visibility as "collectionsVisibility"
    from collections mine
    join collections src on src.id = mine.copied_from_id
    join users u on u.id = src.user_id
    left join user_avatars ua on ua.user_id = u.id
    where mine.id = ${copyId} and mine.user_id = ${meId} and src.parent_id is not null`)).rows;
  if (!src || Number(src.ownerId) === meId) return null;
  const who: Audience = { isMe: false, isFriend: await isFriendOf(Number(src.ownerId), meId) };
  if (src.profileVisibility === "private" || !allows(src.collectionsVisibility, who) || !allows(src.visibility, who)) return null;
  return {
    id: Number(src.id), name: src.name, slug: src.slug, visibility: src.visibility, who,
    owner: { id: Number(src.ownerId), handle: src.handle, displayName: src.displayName, avatarUpdatedAt: src.avatarUpdatedAt ? new Date(src.avatarUpdatedAt).toISOString() : null },
  };
}

/**
 * Every feed in the original I may see and not anywhere in my copy, one row
 * each: `feed_id`, when it first went into the original (`added_at`), and
 * whether I passed on it (`ignored`). Sub-collections of the original I'm not
 * shared with are left out, and so is everything under them.
 */
const missingSql = (copyId: number, orig: Original) => sql`
  with recursive src as (
    select ${orig.id}::bigint as id
    union all select k.id from collections k join src on k.parent_id = src.id where ${allowedLevelsSql("k.visibility", orig.who)}
  ), mine as (
    select ${copyId}::bigint as id
    union all select k.id from collections k join mine on k.parent_id = mine.id
  )
  select cf.feed_id, min(cf.added_at) as added_at,
         exists(select 1 from copy_ignored_feeds ig where ig.collection_id = ${copyId} and ig.feed_id = cf.feed_id) as ignored
  from collection_feeds cf
  where cf.collection_id in (select id from src)
    and not exists(select 1 from collection_feeds x where x.feed_id = cf.feed_id and x.collection_id in (select id from mine))
  group by cf.feed_id`;

/** How many feeds are new to my copy (not passed on), and when the newest of them went into the original. */
export async function newInOriginal(copyId: number, orig: Original): Promise<{ count: number; latest: string | null }> {
  const [r] = (await db.execute<{ count: number; latest: Date | null }>(sql`
    select count(*)::int as count, max(m.added_at) as latest from (${missingSql(copyId, orig)}) m where not m.ignored`)).rows;
  return { count: r.count, latest: r.latest ? new Date(r.latest).toISOString() : null };
}

/**
 * What the original has that my copy doesn't, as the collection page lists
 * feeds, for me to review: new ones first (newest in the original first), then
 * the ones I passed on before.
 */
export async function missingFeeds(copyId: number, meId: number, orig: Original) {
  const rows = await db.execute(sql`
    select f.id, f.url, f.site_url as "siteUrl", f.title, f.description,
           (select fs.display_name from feed_settings fs where fs.user_id = ${meId} and fs.feed_id = f.id) as "displayName",
           ${feedSlugSql} as slug,
           f.last_item_at as "lastItemAt",
           exists(select 1 from feed_icons fi where fi.feed_id = f.id and not fi.generic) as "hasIcon",
           (select count(*)::int from feeds g where g.title = f.title) as "sameTitle",
           coalesce((select array_agg(x.collection_id order by x.collection_id) from collection_feeds x join collections col on col.id = x.collection_id and col.user_id = ${meId} where x.feed_id = f.id), '{}') as "myCollectionIds",
           m.added_at as "addedAt", m.ignored
    from (${missingSql(copyId, orig)}) m join feeds f on f.id = m.feed_id
    order by m.ignored, m.added_at desc, lower(coalesce(f.title, f.url))
  `);
  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
  return rows.rows.map((f: any) => ({ ...f, id: Number(f.id), lastItemAt: iso(f.lastItemAt), addedAt: iso(f.addedAt) }));
}

/**
 * Finish a review: `add` goes into the top of my copy, `ignore` is remembered
 * as passed on. Only feeds the original has that my copy doesn't count; any
 * other id is left alone. Something taken is no longer passed on.
 */
export async function applyReview(copyId: number, orig: Original, add: number[], ignore: number[]): Promise<{ added: number; ignored: number }> {
  return db.transaction(async (tx) => {
    const missing = new Set((await tx.execute<{ feed_id: number }>(missingSql(copyId, orig))).rows.map((r) => Number(r.feed_id)));
    const take = [...new Set(add)].filter((id) => missing.has(id));
    const pass = [...new Set(ignore)].filter((id) => missing.has(id) && !take.includes(id));
    if (take.length) {
      await tx.execute(sql`insert into collection_feeds (collection_id, feed_id) select ${copyId}, unnest(${idArray(take)}) on conflict do nothing`);
      await tx.execute(sql`delete from copy_ignored_feeds where collection_id = ${copyId} and feed_id = any(${idArray(take)})`);
    }
    if (pass.length) await tx.execute(sql`insert into copy_ignored_feeds (collection_id, feed_id) select ${copyId}, unnest(${idArray(pass)}) on conflict do nothing`);
    return { added: take.length, ignored: pass.length };
  });
}

/**
 * Removing a feed from my copy is passing on it: without this, the next look
 * would offer it back as new, since the original still has it. Called after
 * `feedIds` left `within` (collections of mine, or what is left above them).
 * For each copy with updates on that `within` sits in, a feed no longer
 * anywhere in that copy is remembered as passed on, if its original has it.
 * Moving a feed between collections inside one copy changes nothing.
 */
export async function rememberRemoved(meId: number, feedIds: number[], within: number[]): Promise<void> {
  if (!feedIds.length || !within.length) return;
  await db.execute(sql`
    with recursive up as (
      select c.id, c.parent_id, c.follows_original, c.copied_from_id from collections c where c.id = any(${idArray(within)}) and c.user_id = ${meId}
      union select p.id, p.parent_id, p.follows_original, p.copied_from_id from collections p join up on p.id = up.parent_id
    ), copies as (
      select distinct id, copied_from_id from up where follows_original and copied_from_id is not null
    )
    insert into copy_ignored_feeds (collection_id, feed_id)
    select cp.id, f.id from copies cp cross join unnest(${idArray(feedIds)}) as f(id)
    where exists(
            with recursive src as (select cp.copied_from_id as id union all select k.id from collections k join src on k.parent_id = src.id)
            select 1 from collection_feeds x where x.feed_id = f.id and x.collection_id in (select id from src))
      and not exists(
            with recursive mine as (select cp.id as id union all select k.id from collections k join mine on k.parent_id = mine.id)
            select 1 from collection_feeds x where x.feed_id = f.id and x.collection_id in (select id from mine))
    on conflict do nothing`);
}

/**
 * For my copy's own page: whether updates are on, whether its original can
 * still be seen, and how many feeds are new in it. Null when it isn't a copy.
 */
export async function updatesFor(copyId: number, meId: number): Promise<{ on: boolean; available: boolean; newFeeds: number } | null> {
  const [col] = (await db.execute<{ followsOriginal: boolean; copiedFromId: number | null }>(sql`
    select follows_original as "followsOriginal", copied_from_id as "copiedFromId" from collections where id = ${copyId} and user_id = ${meId}`)).rows;
  if (!col || col.copiedFromId === null) return null;
  const orig = await originalOf(copyId, meId);
  if (!orig) return { on: col.followsOriginal, available: false, newFeeds: 0 };
  return { on: col.followsOriginal, available: true, newFeeds: col.followsOriginal ? (await newInOriginal(copyId, orig)).count : 0 };
}
