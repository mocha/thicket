/**
 * Public profiles: what one person can see of another. Readable signed out.
 *
 * Visibility is checked in layers, most restrictive first:
 *   profile private → only the handle and "this profile is private"
 *   section not shared with this viewer → section absent. Each section has an
 *     audience: private, the people the owner follows, or anyone.
 *   collection private (is_public = false) → not listed, 404 if addressed.
 *     A collection can only narrow its section, never widen it.
 * The owner always sees everything on their own profile, with a flag saying
 * what others would see. Follower counts include private profiles: opaque,
 * not absent.
 */
import { Hono, type Context } from "hono";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import { currentUser, normalizeHandle } from "../lib/auth.js";
import { exportCollectionOpml } from "../lib/opml.js";
import { PUBLIC_URL } from "../lib/config.js";
import { slugify, uniqueCollectionSlug } from "../lib/slug.js";
import { activityForViewer } from "../lib/activity.js";
import { allows, isFriendOf, type Audience } from "../lib/visibility.js";

export const profiles = new Hono();

type Owner = typeof schema.users.$inferSelect;

async function owner(handleRaw: string): Promise<Owner | null> {
  const [u] = await db.select().from(schema.users).where(eq(schema.users.handle, normalizeHandle(handleRaw)));
  return u ?? null;
}

/**
 * What this viewer is to this owner. One follow lookup answers every section,
 * so it is done once per request rather than per section.
 */
async function audienceFor(u: Owner, viewerId: number | undefined): Promise<Audience> {
  const isMe = viewerId === u.id;
  return { isMe, isFriend: isMe ? false : await isFriendOf(u.id, viewerId ?? null) };
}

const publicUser = (u: Owner) => ({ handle: u.handle, displayName: u.displayName, bio: u.bio, homepageUrl: u.homepageUrl, createdAt: u.createdAt.toISOString() });

/** Visible, named collections of an owner: non-root, public (or all, for the owner). */
function collectionRows(u: Owner, isMe: boolean) {
  return db.execute<{ id: number; parentId: number; name: string; slug: string; description: string | null; isPublic: boolean; feedCount: number; copiedFromId: number | null }>(sql`
    select col.id, col.parent_id as "parentId", col.name, col.slug, col.description, col.is_public as "isPublic", col.copied_from_id as "copiedFromId",
           (select count(*)::int from collection_feeds cf where cf.collection_id = col.id) as "feedCount"
    from collections col
    where col.user_id = ${u.id} and col.parent_id is not null ${isMe ? sql`` : sql`and col.is_public`}
    order by lower(col.name)
  `);
}

profiles.get("/:handle", async (c) => {
  const u = await owner(c.req.param("handle"));
  if (!u) return c.json({ error: "not found" }, 404);
  const viewer = c.get("user");
  const who = await audienceFor(u, viewer?.id);
  const isMe = who.isMe;
  if (u.profileVisibility === "private" && !isMe) return c.json({ handle: u.handle, private: true });

  const [{ following }] = (await db.execute<{ following: number }>(sql`
    select count(distinct cf.feed_id)::int as following from collection_feeds cf join collections col on col.id = cf.collection_id where col.user_id = ${u.id}
  `)).rows;
  const [{ bookmarkCount }] = (await db.execute<{ bookmarkCount: number }>(sql`select count(*)::int as "bookmarkCount" from bookmarks where user_id = ${u.id}`)).rows;
  const [people] = (await db.execute<{ follows: number; followers: number; isFollowing: boolean }>(sql`
    select (select count(*)::int from user_follows where follower_id = ${u.id}) as follows,
           (select count(*)::int from user_follows where followee_id = ${u.id}) as followers,
           exists(select 1 from user_follows where follower_id = ${viewer?.id ?? -1} and followee_id = ${u.id}) as "isFollowing"
  `)).rows;
  const [{ noteCount }] = (await db.execute<{ noteCount: number }>(sql`select count(*)::int as "noteCount" from notes where user_id = ${u.id}`)).rows;
  const collections = allows(u.collectionsVisibility, who) ? (await collectionRows(u, isMe)).rows : null;

  return c.json({
    ...publicUser(u), private: false, isMe, following,
    /** People: how many this person follows, how many follow them, and whether the viewer does. */
    people: { follows: people.follows, followers: people.followers, isFollowing: people.isFollowing },
    /** Notes they have left, if they share them with this viewer (always for the owner). */
    notes: allows(u.notesVisibility, who) ? { count: noteCount } : null,
    /** null = the owner hides this section. */
    collections,
    bookmarks: allows(u.bookmarksVisibility, who) ? { count: bookmarkCount } : null,
    /** For the owner: who each section is shared with, so the page can say what others see. */
    visibility: isMe ? { profile: u.profileVisibility, collections: u.collectionsVisibility, bookmarks: u.bookmarksVisibility, notes: u.notesVisibility } : undefined,
  });
});

/**
 * Follow a person. One-directional; nothing is sent to them. You can only
 * follow a profile you can see, so a private profile is a 404 here too.
 */
profiles.post("/:handle/follow", async (c) => {
  const viewer = currentUser(c);
  const u = await owner(c.req.param("handle"));
  if (!u || u.profileVisibility === "private") return c.json({ error: "not found" }, 404);
  if (u.id === viewer.id) return c.json({ error: "That’s you." }, 400);
  await db.insert(schema.userFollows).values({ followerId: viewer.id, followeeId: u.id }).onConflictDoNothing();
  return c.json({ handle: u.handle, isFollowing: true });
});

profiles.delete("/:handle/follow", async (c) => {
  const viewer = currentUser(c);
  const u = await owner(c.req.param("handle"));
  if (!u) return c.json({ error: "not found" }, 404);
  await db.delete(schema.userFollows).where(and(eq(schema.userFollows.followerId, viewer.id), eq(schema.userFollows.followeeId, u.id)));
  return c.json({ handle: u.handle, isFollowing: false });
});

type ColRow = { id: number; name: string; slug: string; description: string | null; isPublic: boolean; createdAt: string; depth: number };

/**
 * Resolve a collection by handle + slug, with visibility applied. Slugs are
 * unique per user (migration 0005), so a slug names exactly one collection at
 * any depth — no shallowest-match tiebreak, and no collection that exists but
 * has no working address. The root is excluded for everyone, owner included:
 * it is the tree's parent, holds nothing, and has no page.
 */
async function visibleCollection(c: Context, handleRaw: string, slug: string) {
  const u = await owner(handleRaw);
  if (!u) return { error: "not found" as const, status: 404 as const };
  const viewer = c.get("user");
  const who = await audienceFor(u, viewer?.id);
  const isMe = who.isMe;
  if (!isMe && (u.profileVisibility === "private" || !allows(u.collectionsVisibility, who))) return { error: "not found" as const, status: 404 as const };
  const rows = await db.execute<ColRow>(sql`
    with recursive t as (
      select col.id, col.parent_id, col.name, col.slug, col.description, col.is_public, col.created_at, 0 as depth from collections col where col.user_id = ${u.id} and col.parent_id is null
      union all select col.id, col.parent_id, col.name, col.slug, col.description, col.is_public, col.created_at, t.depth + 1 from collections col join t on col.parent_id = t.id
    )
    select id, name, slug, description, is_public as "isPublic", created_at as "createdAt", depth
    from t where slug = ${slug} and depth > 0 ${isMe ? sql`` : sql`and is_public`} limit 1
  `);
  const col = rows.rows[0];
  if (!col) return { error: "not found" as const, status: 404 as const };
  return { u, col: { ...col, id: Number(col.id) }, isMe, viewer };
}

/** A public collection: its feeds (with the viewer's relationship, if signed in) and children. */
profiles.get("/:handle/collections/:slug", async (c) => {
  const r = await visibleCollection(c, c.req.param("handle"), c.req.param("slug"));
  if ("error" in r) return c.json({ error: r.error }, r.status);
  const viewerId = r.viewer?.id ?? -1;
  const feeds = await db.execute(sql`
    select f.id, f.url, f.site_url as "siteUrl", coalesce(cf.title_override, f.title) as title, f.description,
           (select fs.display_name from feed_settings fs where fs.user_id = ${viewerId} and fs.feed_id = f.id) as "displayName",
           coalesce(nullif(left(trim(both '-' from regexp_replace(lower(f.title), '[^a-z0-9]+', '-', 'g')), 60), ''), 'feed') as slug,
           f.last_item_at as "lastItemAt",
           exists(select 1 from feed_icons fi where fi.feed_id = f.id and not fi.generic) as "hasIcon",
           (select count(*)::int from feeds g where g.title = f.title) as "sameTitle",
           (select count(distinct col.user_id)::int from collection_feeds x join collections col on col.id = x.collection_id where x.feed_id = f.id) as "followerCount",
           coalesce((select array_agg(x.collection_id order by x.collection_id) from collection_feeds x join collections col on col.id = x.collection_id and col.user_id = ${viewerId} where x.feed_id = f.id), '{}') as "myCollectionIds"
    from collection_feeds cf join feeds f on f.id = cf.feed_id
    where cf.collection_id = ${r.col.id} order by lower(coalesce(cf.title_override, f.title, f.url))
  `);
  const children = await db.execute(sql`
    select col.id, col.name, col.slug, col.description, (select count(*)::int from collection_feeds cf where cf.collection_id = col.id) as "feedCount"
    from collections col where col.parent_id = ${r.col.id} ${r.isMe ? sql`` : sql`and col.is_public`} order by lower(col.name)
  `);
  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
  return c.json({
    id: r.col.id, name: r.col.name, slug: r.col.slug, description: r.col.description, isPublic: r.col.isPublic, createdAt: iso(r.col.createdAt),
    owner: publicUser(r.u), isMe: r.isMe,
    feeds: feeds.rows.map((f: any) => ({ ...f, lastItemAt: iso(f.lastItemAt) })),
    children: children.rows,
  });
});

/**
 * The portable form of a public collection. This is what another instance (or
 * any reader) fetches to copy it: same visibility rules, no sign-in needed.
 */
profiles.get("/:handle/collections/:slug/opml", async (c) => {
  const r = await visibleCollection(c, c.req.param("handle"), c.req.param("slug"));
  if ("error" in r) return c.json({ error: r.error }, r.status);
  const xml = await exportCollectionOpml(r.col, r.u.displayName ?? `@${r.u.handle}`, `${PUBLIC_URL}/@${r.u.handle}`);
  c.header("content-type", "text/x-opml; charset=utf-8");
  c.header("content-disposition", `inline; filename="${r.u.handle}-${r.col.slug}.opml"`);
  c.header("cache-control", "public, max-age=300");
  return c.body(xml);
});

/**
 * Copy a collection into my own, as-is: same name (deduped), same feeds,
 * sub-collections included. The copy is mine and independent; copied_from_id
 * records where it came from. Feeds I already follow simply gain a collection.
 */
profiles.post("/:handle/collections/:slug/copy", async (c) => {
  const me = currentUser(c);
  const r = await visibleCollection(c, c.req.param("handle"), c.req.param("slug"));
  if ("error" in r) return c.json({ error: r.error }, r.status);
  if (r.isMe) return c.json({ error: "That’s already yours." }, 400);
  const raw = r.col;

  const created = await db.transaction(async (tx) => {
    // Name dedupe: "News", then "News (from @handle)", then "News (from @handle) 2"...
    // Against every slug of mine, since slugs are unique per user rather than per parent.
    const mine = await tx.select({ slug: schema.collections.slug }).from(schema.collections).where(eq(schema.collections.userId, me.id));
    const taken = new Set(mine.map((m) => m.slug));
    let name = raw.name;
    if (taken.has(slugify(name))) name = `${raw.name} (from @${r.u.handle})`;
    for (let n = 2; taken.has(slugify(name)); n++) name = `${raw.name} (from @${r.u.handle}) ${n}`;

    // A sub-collection's name can collide with something elsewhere in my tree,
    // so each one asks for its own free slug as it is created.
    async function copyTree(srcId: number, parentId: number, nm: string, description: string | null) {
      const slug = await uniqueCollectionSlug(me.id, nm, { tx });
      const [col] = await tx.insert(schema.collections).values({ userId: me.id, parentId, name: nm, slug, description, copiedFromId: srcId }).returning();
      await tx.execute(sql`insert into collection_feeds (collection_id, feed_id, title_override) select ${col.id}, feed_id, title_override from collection_feeds where collection_id = ${srcId} on conflict do nothing`);
      // Private sub-collections stay behind; the owner chose not to show them.
      const kids = await tx.select().from(schema.collections).where(and(eq(schema.collections.parentId, srcId), eq(schema.collections.isPublic, true)));
      for (const k of kids) await copyTree(k.id, col.id, k.name, k.description);
      return col;
    }
    return copyTree(r.col.id, me.rootCollectionId, name, raw.description);
  });
  const [{ feedCount }] = (await db.execute<{ feedCount: number }>(sql`select count(*)::int as "feedCount" from collection_feeds where collection_id = ${created.id}`)).rows;
  return c.json({ ...created, feedCount }, 201);
});

/** Someone's public bookmarks, newest first, with whether I already have each URL. */
profiles.get("/:handle/bookmarks", async (c) => {
  const u = await owner(c.req.param("handle"));
  if (!u) return c.json({ error: "not found" }, 404);
  const viewer = c.get("user");
  const who = await audienceFor(u, viewer?.id);
  const isMe = who.isMe;
  if (!isMe && (u.profileVisibility === "private" || !allows(u.bookmarksVisibility, who))) return c.json({ error: "not found" }, 404);
  const limit = Math.min(100, Math.max(1, Number(c.req.query("limit") ?? 40)));
  const before = c.req.query("before");
  let cursor = sql``;
  if (before) {
    const [ts, id] = before.split("|");
    cursor = sql`and (b.saved_at, b.id) < (${ts}::timestamptz, ${Number(id)}::bigint)`;
  }
  const viewerId = viewer?.id ?? -1;
  const rows = await db.execute(sql`
    select b.id, b.item_id as "itemId", b.feed_id as "feedId", b.url, b.title, b.summary, b.image_url as "imageUrl",
           b.site_title as "siteTitle", b.author, b.published_at as "publishedAt", b.saved_at as "savedAt",
           exists(select 1 from feed_icons fi where fi.feed_id = b.feed_id and not fi.generic) as "hasIcon",
           (select mine.id from bookmarks mine where mine.user_id = ${viewerId} and mine.url = b.url limit 1) as "myBookmarkId"
    from bookmarks b where b.user_id = ${u.id} ${cursor}
    order by b.saved_at desc, b.id desc limit ${limit + 1}
  `);
  const all = rows.rows as any[];
  const page = all.slice(0, limit);
  const last = all.length > limit ? page[page.length - 1] : null;
  return c.json({ owner: publicUser(u), isMe, bookmarks: page, nextCursor: last ? `${new Date(last.savedAt).toISOString()}|${last.id}` : null });
});

/**
 * What this person has been up to. The page version: it takes a viewer and
 * shows what that viewer is allowed to see, which for the owner is everything.
 * A private profile is a 404 here as everywhere else.
 */
profiles.get("/:handle/activity", async (c) => {
  const u = await owner(c.req.param("handle"));
  if (!u) return c.json({ error: "not found" }, 404);
  const viewer = c.get("user");
  const who = await audienceFor(u, viewer?.id);
  if (!who.isMe && u.profileVisibility === "private") return c.json({ error: "not found" }, 404);
  const limit = Math.min(50, Math.max(1, Number(c.req.query("limit") ?? 20)));
  const { entries, nextCursor } = await activityForViewer(u, who, { limit, before: c.req.query("before") });
  return c.json({ owner: publicUser(u), isMe: who.isMe, entries, nextCursor });
});
