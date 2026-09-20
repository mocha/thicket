/**
 * Public profiles: what one person can see of another. Readable signed out.
 *
 * Visibility is checked in layers, most restrictive first:
 *   profile private → only the handle and "this profile is private"
 *   section not shared with this viewer → section absent. Each section has an
 *     audience: private, the people the owner follows, or anyone.
 *   collection narrower than its section (collections.visibility) → not
 *     listed, 404 if addressed. A collection can only narrow, never widen.
 * The owner always sees everything on their own profile, with a flag saying
 * what others would see. Follower counts include private profiles: opaque,
 * not absent.
 */
import { Hono, type Context } from "hono";
import { and, eq, inArray, sql } from "drizzle-orm";
import { subtreeFeedCount } from "../lib/subtree.js";
import { db, schema } from "../db/client.js";
import { currentUser, normalizeHandle } from "../lib/auth.js";
import { exportCollectionOpml } from "../lib/opml.js";
import { PUBLIC_URL } from "../lib/config.js";
import { feedSlugSql, slugify, uniqueCollectionSlug } from "../lib/slug.js";
import { activityForViewer } from "../lib/activity.js";
import { noteColumns } from "../lib/notes.js";
import { allowedLevels, allowedLevelsSql, allows, isFriendOf, type Audience, type ShareLevel } from "../lib/visibility.js";
import { visitorCap } from "../lib/instance.js";

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

const publicUser = (u: Owner, avatarUpdatedAt: string | null = null) => ({ handle: u.handle, displayName: u.displayName, bio: u.bio, homepageUrl: u.homepageUrl, createdAt: u.createdAt.toISOString(), avatarUpdatedAt });

/** When was this user's avatar last set, if ever? Null means they have none (render a monogram). */
async function avatarTime(userId: number): Promise<string | null> {
  const [a] = await db.select({ updatedAt: schema.userAvatars.updatedAt }).from(schema.userAvatars).where(eq(schema.userAvatars.userId, userId));
  return a?.updatedAt.toISOString() ?? null;
}

/** Visible, named collections of an owner: non-root, and shared with this viewer (all of them, for the owner). */
function collectionRows(u: Owner, who: Audience) {
  return db.execute<{ id: number; parentId: number; name: string; slug: string; description: string | null; visibility: ShareLevel; feedCount: number; copiedFromId: number | null }>(sql`
    select col.id, col.parent_id as "parentId", col.name, col.slug, col.description, col.visibility, col.copied_from_id as "copiedFromId",
           ${subtreeFeedCount(sql`col.id`)} as "feedCount"
    from collections col
    where col.user_id = ${u.id} and col.parent_id is not null and ${allowedLevelsSql("col.visibility", who)}
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
  const collections = allows(u.collectionsVisibility, who) ? (await collectionRows(u, who)).rows : null;

  return c.json({
    ...publicUser(u, await avatarTime(u.id)), private: false, isMe, following,
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
 * The people this person follows. Visible whenever the profile itself is (a
 * private profile is a 404 here too). Only public followees are listed — a
 * private profile stays opaque even in someone else's following list — so the
 * count can be smaller than the raw follow count on the profile.
 */
profiles.get("/:handle/following", async (c) => {
  const u = await owner(c.req.param("handle"));
  if (!u) return c.json({ error: "not found" }, 404);
  const who = await audienceFor(u, c.get("user")?.id);
  if (u.profileVisibility === "private" && !who.isMe) return c.json({ error: "not found" }, 404);
  const rows = (await db.execute<{ handle: string; displayName: string | null; bio: string | null; homepageUrl: string | null; createdAt: Date; avatarUpdatedAt: Date | null }>(sql`
    select tu.handle, tu.display_name as "displayName", tu.bio, tu.homepage_url as "homepageUrl", tu.created_at as "createdAt", ua.updated_at as "avatarUpdatedAt"
    from user_follows uf join users tu on tu.id = uf.followee_id
    left join user_avatars ua on ua.user_id = tu.id
    where uf.follower_id = ${u.id} and tu.profile_visibility = 'public'
    order by lower(coalesce(tu.display_name, tu.handle))
  `)).rows;
  const users = rows.map((r) => ({ handle: r.handle, displayName: r.displayName, bio: r.bio, homepageUrl: r.homepageUrl, createdAt: new Date(r.createdAt).toISOString(), avatarUpdatedAt: r.avatarUpdatedAt ? new Date(r.avatarUpdatedAt).toISOString() : null }));
  return c.json({ owner: publicUser(u), isMe: who.isMe, users });
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

type ColRow = { id: number; name: string; slug: string; description: string | null; visibility: ShareLevel; createdAt: string; depth: number };

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
      select col.id, col.parent_id, col.name, col.slug, col.description, col.visibility, col.created_at, 0 as depth from collections col where col.user_id = ${u.id} and col.parent_id is null
      union all select col.id, col.parent_id, col.name, col.slug, col.description, col.visibility, col.created_at, t.depth + 1 from collections col join t on col.parent_id = t.id
    )
    select id, name, slug, description, visibility, created_at as "createdAt", depth
    from t where slug = ${slug} and depth > 0 and ${allowedLevelsSql("visibility", who)} limit 1
  `);
  const col = rows.rows[0];
  if (!col) return { error: "not found" as const, status: 404 as const };
  return { u, col: { ...col, id: Number(col.id) }, isMe, who, viewer };
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
    select col.id, col.name, col.slug, col.description, ${subtreeFeedCount(sql`col.id`)} as "feedCount"
    from collections col where col.parent_id = ${r.col.id} and ${allowedLevelsSql("col.visibility", r.who)} order by lower(col.name)
  `);
  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
  return c.json({
    id: r.col.id, name: r.col.name, slug: r.col.slug, description: r.col.description, visibility: r.col.visibility, createdAt: iso(r.col.createdAt),
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
  // A sub-collection this reader may not see stays out of the file, the same as it stays off the page.
  const xml = await exportCollectionOpml(r.col, r.u.displayName ?? `@${r.u.handle}`, `${PUBLIC_URL}/@${r.u.handle}`, allowedLevels(r.who));
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
  // Sub-collections I am allowed to see come along; the rest stay behind.
  const mineToTake = allowedLevels(r.who);

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
      // Sub-collections the owner doesn't share with me stay behind; I copy
      // what I can see, which is what the page showed me.
      const kids = await tx.select().from(schema.collections).where(and(eq(schema.collections.parentId, srcId), inArray(schema.collections.visibility, mineToTake)));
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
  // Signed out, one page of at most VISITOR_CAP and nothing after it (lib/instance.ts).
  const cap = await visitorCap(viewer);
  const limit = Math.min(cap ?? 100, Math.max(1, Number(c.req.query("limit") ?? 40)));
  const before = c.req.query("before");
  if (cap && before) return c.json({ owner: publicUser(u), isMe, bookmarks: [], nextCursor: null, cappedAt: cap });
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
  return c.json({ owner: publicUser(u), isMe, bookmarks: page, nextCursor: last && !cap ? `${new Date(last.savedAt).toISOString()}|${last.id}` : null, cappedAt: cap && last ? cap : null });
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
  // Signed out, one page of at most VISITOR_CAP and nothing after it (lib/instance.ts).
  const cap = await visitorCap(viewer);
  const before = c.req.query("before");
  if (cap && before) return c.json({ owner: publicUser(u), isMe: who.isMe, entries: [], nextCursor: null, cappedAt: cap });
  const limit = Math.min(cap ?? 50, Math.max(1, Number(c.req.query("limit") ?? 20)));
  const { entries, nextCursor } = await activityForViewer(u, who, { limit, before });
  return c.json({ owner: publicUser(u), isMe: who.isMe, entries, nextCursor: cap ? null : nextCursor, cappedAt: cap && nextCursor ? cap : null });
});

/**
 * A person's notes as a body of work: the posts they noted, newest note first,
 * in river shape, so the page is the same cards as everywhere else. Readable by
 * whoever their notes are shared with, signed-out visitors included when that
 * is Anyone. Their note comes back first in `notes` (or as `myNote`, for them).
 */
profiles.get("/:handle/notes", async (c) => {
  const u = await owner(c.req.param("handle"));
  if (!u) return c.json({ error: "not found" }, 404);
  const viewer = c.get("user");
  const who = await audienceFor(u, viewer?.id);
  if (!who.isMe && (u.profileVisibility === "private" || !allows(u.notesVisibility, who))) return c.json({ error: "not found" }, 404);
  // Signed out, one page of at most VISITOR_CAP and nothing after it (lib/instance.ts).
  const cap = await visitorCap(viewer);
  const limit = Math.min(cap ?? 100, Math.max(1, Number(c.req.query("limit") ?? 30)));
  const before = c.req.query("before"); // "<iso>|<noteId>"
  if (cap && before) return c.json({ owner: publicUser(u), isMe: who.isMe, items: [], nextCursor: null, cappedAt: cap });
  let cursor = sql``;
  if (before) {
    const [ts, id] = before.split("|");
    cursor = sql`and (theirs.created_at, theirs.id) < (${ts}::timestamptz, ${Number(id)}::bigint)`;
  }
  const viewerId = viewer?.id ?? -1;
  const rows = await db.execute<any>(sql`
    select i.id, i.feed_id as "feedId", f.title as "feedTitle", f.site_url as "siteUrl", ${feedSlugSql} as "feedSlug",
           i.url, i.title, i.author, i.summary, i.image_url as "imageUrl", i.published_at as "publishedAt",
           exists(select 1 from feed_icons fi where fi.feed_id = i.feed_id and not fi.generic) as "hasIcon",
           (select bm.id from bookmarks bm where bm.user_id = ${viewerId} and bm.item_id = i.id limit 1) as "bookmarkId",
           theirs.id as "noteId", theirs.created_at as "notedAt",
           ${noteColumns(viewerId, u.id)}
    from notes theirs
    join items i on i.id = theirs.item_id
    join feeds f on f.id = i.feed_id
    where theirs.user_id = ${u.id} ${cursor}
    order by theirs.created_at desc, theirs.id desc
    limit ${limit + 1}
  `);
  const all = rows.rows;
  const page = all.slice(0, limit);
  const last = all.length > limit ? page[page.length - 1] : null;
  return c.json({
    owner: publicUser(u), isMe: who.isMe,
    items: page.map(({ noteId, notedAt, ...r }: any) => ({ ...r, publishedAt: new Date(r.publishedAt).toISOString() })),
    nextCursor: last && !cap ? `${new Date(last.notedAt).toISOString()}|${last.noteId}` : null,
    cappedAt: cap && last ? cap : null,
  });
});
