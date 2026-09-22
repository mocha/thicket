import { Hono } from "hono";
import { and, eq, sql } from "drizzle-orm";
import { subtreeFeedCount } from "../lib/subtree.js";
import { db, schema } from "../db/client.js";
import { currentUser } from "../lib/user.js";
import { slugify, slugTaken, uniqueCollectionSlug } from "../lib/slug.js";
import { isShareLevel } from "../lib/visibility.js";

export const collections = new Hono();
/** Flat list with parent pointers and feed counts; the client builds the tree. */
collections.get("/", async (c) => {
  const user = currentUser(c);
  const rows = await db.execute(sql`
    select col.id, col.parent_id as "parentId", col.name, col.slug, col.description, col.visibility,
           ${subtreeFeedCount(sql`col.id`)} as "feedCount"
    from collections col where col.user_id = ${user.id} order by col.parent_id nulls first, lower(col.name)
  `);
  return c.json({ collections: rows.rows, rootId: user.rootCollectionId });
});

collections.post("/", async (c) => {
  const user = currentUser(c);
  const body = await c.req.json<{ name: string; parentId?: number; description?: string }>();
  if (!body.name?.trim()) return c.json({ error: "name is required" }, 400);
  // Sub-collections are on hold (2026-09-20, per Patrick). This parentId path
  // works and is exercised by seeding, but no shipping UI passes one yet, so in
  // practice every collection created here lands at the top level. Don't wire a
  // "create sub-collection" affordance until Product decides the feature is
  // wanted or needed. (Matching note in web collections.svelte.ts.)
  const parentId = body.parentId ?? user.rootCollectionId;
  const [parent] = await db.select().from(schema.collections).where(and(eq(schema.collections.id, parentId), eq(schema.collections.userId, user.id)));
  if (!parent) return c.json({ error: "parent not found" }, 404);
  // A person typed this name. Say it is taken rather than quietly renaming it;
  // the machine paths (copy, import) are the ones that dedupe on their own.
  const slug = slugify(body.name);
  if (await slugTaken(user.id, slug)) return c.json({ error: "You already have a collection with that name.", field: "name" }, 400);
  const [row] = await db.insert(schema.collections).values({ userId: user.id, parentId, name: body.name.trim(), slug, description: body.description ?? null }).returning();
  return c.json(row, 201);
});

collections.patch("/:id", async (c) => {
  const user = currentUser(c);
  const id = Number(c.req.param("id"));
  const body = await c.req.json<{ name?: string; description?: string; parentId?: number; visibility?: string }>();
  if (body.parentId !== undefined) {
    if (body.parentId === id) return c.json({ error: "a collection cannot contain itself" }, 400);
    // Cycle check: the new parent must not be a descendant of this collection.
    const desc = await db.execute<{ id: number }>(sql`with recursive t as (select id from collections where id = ${id} union all select c.id from collections c join t on c.parent_id = t.id) select id from t`);
    if (desc.rows.some((r) => Number(r.id) === body.parentId)) return c.json({ error: "cannot move a collection under its own descendant" }, 400);
  }
  const patch: Partial<typeof schema.collections.$inferInsert> = {};
  if (body.name !== undefined) {
    const slug = slugify(body.name);
    if (await slugTaken(user.id, slug, id)) return c.json({ error: "You already have a collection with that name.", field: "name" }, 400);
    patch.name = body.name.trim(); patch.slug = slug;
  }
  if (body.description !== undefined) patch.description = body.description;
  if (body.parentId !== undefined) patch.parentId = body.parentId;
  // The audience is the account's scale (share_level); a collection can only narrow it, never widen it (lib/visibility.ts).
  if (isShareLevel(body.visibility)) patch.visibility = body.visibility;
  // Nothing recognized in the body: say so, rather than asking the database to set no columns.
  if (Object.keys(patch).length === 0) return c.json({ error: "nothing to update" }, 400);
  const [row] = await db.update(schema.collections).set(patch).where(and(eq(schema.collections.id, id), eq(schema.collections.userId, user.id))).returning();
  return row ? c.json(row) : c.json({ error: "not found" }, 404);
});

/** Deleting a collection re-homes its children to its parent so nothing is orphaned. The root cannot be deleted. */
collections.delete("/:id", async (c) => {
  const user = currentUser(c);
  const id = Number(c.req.param("id"));
  if (id === user.rootCollectionId) return c.json({ error: "cannot delete the root collection" }, 400);
  const [row] = await db.select().from(schema.collections).where(and(eq(schema.collections.id, id), eq(schema.collections.userId, user.id)));
  if (!row) return c.json({ error: "not found" }, 404);
  // Re-home children to this collection's parent, then delete — in one transaction,
  // so a crash between the two can't leave children pointing at a collection that's
  // gone. (The parent_id FK cascades on delete; reparenting first is what keeps the
  // sub-tree rather than deleting it.)
  await db.transaction(async (tx) => {
    await tx.update(schema.collections).set({ parentId: row.parentId }).where(eq(schema.collections.parentId, id));
    await tx.delete(schema.collections).where(eq(schema.collections.id, id));
  });
  return c.json({ deleted: id });
});

/**
 * Merge this collection INTO another of mine. The other one keeps its name,
 * description, address and visibility, and gains every feed this one held that
 * it didn't; this one's sub-collections move under it; then this one is
 * deleted. Nothing stops being followed, since every feed here lands there.
 * Other people's copies that recorded this one as their source now record the
 * collection its feeds went to.
 */
collections.post("/:id/merge", async (c) => {
  const user = currentUser(c);
  const id = Number(c.req.param("id"));
  const body = await c.req.json<{ intoId?: number }>().catch(() => ({} as { intoId?: number }));
  const intoId = Number(body.intoId);
  if (!Number.isFinite(intoId) || intoId === id) return c.json({ error: "Pick another collection to merge into." }, 400);
  const mine = await db.select().from(schema.collections).where(and(eq(schema.collections.userId, user.id), sql`${schema.collections.id} in (${id}, ${intoId})`));
  const from = mine.find((x) => x.id === id);
  const into = mine.find((x) => x.id === intoId);
  if (!from || !into) return c.json({ error: "not found" }, 404);
  if (from.parentId === null || into.parentId === null) return c.json({ error: "Pick one of your collections." }, 400);
  const tree = await db.execute<{ id: number }>(sql`with recursive t as (select id from collections where id = ${id} union all select c.id from collections c join t on c.parent_id = t.id) select id from t`);
  if (tree.rows.some((r) => Number(r.id) === intoId)) return c.json({ error: "A collection can’t be merged into one of its own sub-collections." }, 400);
  const result = await db.transaction(async (tx) => {
    const added = await tx.execute(sql`
      insert into collection_feeds (collection_id, feed_id, added_at)
      select ${intoId}, feed_id, added_at from collection_feeds where collection_id = ${id}
      on conflict do nothing returning feed_id`);
    const moved = await tx.update(schema.collections).set({ parentId: intoId }).where(eq(schema.collections.parentId, id)).returning({ id: schema.collections.id });
    await tx.update(schema.collections).set({ copiedFromId: intoId }).where(eq(schema.collections.copiedFromId, id));
    await tx.delete(schema.collections).where(eq(schema.collections.id, id));
    return { added: added.rows.length, movedChildren: moved.length };
  });
  return c.json({ into: { id: into.id, name: into.name, slug: into.slug }, ...result });
});

collections.put("/:id/feeds/:feedId", async (c) => {
  const user = currentUser(c);
  const collectionId = Number(c.req.param("id"));
  const feedId = Number(c.req.param("feedId"));
  const [col] = await db.select().from(schema.collections).where(and(eq(schema.collections.id, collectionId), eq(schema.collections.userId, user.id)));
  if (!col) return c.json({ error: "not found" }, 404);
  await addFeedToCollection(collectionId, feedId);
  return c.json({ collectionId, feedId });
});

/**
 * Before deleting: the feeds that live only in this collection (or its
 * sub-collections) and would therefore stop being followed. Alphabetical,
 * with enough to link each to its page so the owner can rehome it first.
 */
collections.get("/:id/orphans", async (c) => {
  const user = currentUser(c);
  const id = Number(c.req.param("id"));
  const [col] = await db.select().from(schema.collections).where(and(eq(schema.collections.id, id), eq(schema.collections.userId, user.id)));
  if (!col) return c.json({ error: "not found" }, 404);
  const rows = await db.execute(sql`
    with recursive tree as (select id from collections where id = ${id} union all select c.id from collections c join tree t on c.parent_id = t.id)
    select * from (
      select distinct f.id, f.title, f.url, f.site_url as "siteUrl",
             coalesce(nullif(left(trim(both '-' from regexp_replace(lower(f.title), '[^a-z0-9]+', '-', 'g')), 60), ''), 'feed') as slug,
             exists(select 1 from feed_icons fi where fi.feed_id = f.id and not fi.generic) as "hasIcon"
      from collection_feeds cf join tree on tree.id = cf.collection_id join feeds f on f.id = cf.feed_id
      where not exists (
        select 1 from collection_feeds x join collections o on o.id = x.collection_id
        where x.feed_id = cf.feed_id and o.user_id = ${user.id} and o.id not in (select id from tree)
      )
    ) o order by lower(coalesce(o.title, o.url))
  `);
  return c.json({ feeds: rows.rows });
});

collections.delete("/:id/feeds/:feedId", async (c) => {
  const user = currentUser(c);
  const collectionId = Number(c.req.param("id"));
  const feedId = Number(c.req.param("feedId"));
  const [col] = await db.select().from(schema.collections).where(and(eq(schema.collections.id, collectionId), eq(schema.collections.userId, user.id)));
  if (!col) return c.json({ error: "not found" }, 404);
  await db.delete(schema.collectionFeeds).where(and(eq(schema.collectionFeeds.collectionId, collectionId), eq(schema.collectionFeeds.feedId, feedId)));
  return c.json({ collectionId, feedId, removed: true });
});

import { exportCollectionOpml, importOpml } from "../lib/opml.js";
import { addFeedToCollection } from "../lib/subscribe.js";
import { ImportError, fetchOpml } from "../lib/importer.js";
import { parseOpml } from "feedsmith";

/** One collection with its feeds (direct members only) and its children. */
collections.get("/:id", async (c) => {
  const user = currentUser(c);
  const id = Number(c.req.param("id"));
  const [col] = await db.select().from(schema.collections).where(and(eq(schema.collections.id, id), eq(schema.collections.userId, user.id)));
  if (!col) return c.json({ error: "not found" }, 404);
  const feeds = await db.execute(sql`
    select f.id, f.url, f.site_url as "siteUrl", coalesce(cf.title_override, f.title) as title, f.kind,
           (select fs.display_name from feed_settings fs where fs.user_id = ${user.id} and fs.feed_id = f.id) as "displayName",
           f.consecutive_failures as "consecutiveFailures", f.last_error as "lastError", f.last_status as "lastStatus",
           f.last_fetched_at as "lastFetchedAt", f.last_item_at as "lastItemAt", cf.added_at as "addedAt",
           exists(select 1 from feed_icons fi where fi.feed_id = f.id and not fi.generic) as "hasIcon",
           (select count(*)::int from feeds g where g.title = f.title) as "sameTitle"
    from collection_feeds cf join feeds f on f.id = cf.feed_id
    where cf.collection_id = ${id} order by lower(coalesce(cf.title_override, f.title, f.url))
  `);
  const children = await db.execute(sql`
    select col.id, col.name, col.slug, col.description, ${subtreeFeedCount(sql`col.id`)} as "feedCount"
    from collections col where col.parent_id = ${id} order by lower(col.name)
  `);
  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
  return c.json({ ...col, feeds: feeds.rows.map((f: any) => ({ ...f, lastFetchedAt: iso(f.lastFetchedAt), lastItemAt: iso(f.lastItemAt), addedAt: iso(f.addedAt) })), children: children.rows });
});

collections.get("/:id/opml", async (c) => {
  const user = currentUser(c);
  const id = Number(c.req.param("id"));
  const [col] = await db.select().from(schema.collections).where(and(eq(schema.collections.id, id), eq(schema.collections.userId, user.id)));
  if (!col) return c.json({ error: "not found" }, 404);
  const xml = await exportCollectionOpml(col);
  c.header("content-type", "text/x-opml; charset=utf-8");
  c.header("content-disposition", `attachment; filename="${col.slug}.opml"`);
  return c.body(xml);
});

/**
 * Copy a collection from anywhere by URL. Accepts a thicket collection page
 * (/@handle/collections/slug on any instance), a page advertising OPML via
 * <link rel="alternate" type="text/x-opml">, or a raw OPML URL. Creates a new
 * collection named from the OPML title (deduped) and imports into it. This is
 * the cross-instance copy path; no federation protocol, just HTTP and OPML.
 */
collections.post("/import-url", async (c) => {
  const user = currentUser(c);
  const body = await c.req.json<{ url?: string; name?: string }>().catch(() => ({} as { url?: string; name?: string }));
  let text: string;
  try {
    text = await fetchOpml(body.url ?? "");
  } catch (err) {
    if (err instanceof ImportError) return c.json({ error: err.message }, 400);
    throw err;
  }
  const target = new URL((body.url ?? "").trim());

  let title: string | null = null;
  try {
    title = parseOpml(text).head?.title?.trim() || null;
  } catch (err) {
    return c.json({ error: `That isn’t a collection we can read: ${err instanceof Error ? err.message : err}` }, 400);
  }
  // Nobody is at the keyboard here, so this renames rather than refusing:
  // "News", then "News 2". Checked against every slug of mine, not just my
  // top-level ones, because slugs are unique per user now.
  const base = (body.name?.trim() || title || target.hostname).slice(0, 80);
  const mine = await db.select({ slug: schema.collections.slug }).from(schema.collections).where(eq(schema.collections.userId, user.id));
  const taken = new Set(mine.map((x) => x.slug));
  let name = base;
  for (let n = 2; taken.has(slugify(name)); n++) name = `${base} ${n}`;
  const [col] = await db.insert(schema.collections).values({ userId: user.id, parentId: user.rootCollectionId, name, slug: slugify(name), description: `Copied from ${target.hostname}` }).returning();
  const result = await importOpml(user.id, col.id, text);
  return c.json({ collection: col, ...result }, 201);
});

/** Body is the raw OPML document (text/xml or text/x-opml). */
collections.post("/:id/import", async (c) => {
  const user = currentUser(c);
  const id = Number(c.req.param("id"));
  const [col] = await db.select().from(schema.collections).where(and(eq(schema.collections.id, id), eq(schema.collections.userId, user.id)));
  if (!col) return c.json({ error: "not found" }, 404);
  const text = await c.req.text();
  if (!text.trim()) return c.json({ error: "empty body" }, 400);
  try {
    const result = await importOpml(user.id, id, text);
    return c.json(result);
  } catch (err) {
    return c.json({ error: `could not parse OPML: ${err instanceof Error ? err.message : err}` }, 400);
  }
});
