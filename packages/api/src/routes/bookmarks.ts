/**
 * Bookmarks: one private set per user. Saved from a river item (snapshot taken
 * at save time) or from a bare URL. Filterable by source feed or by any
 * collection the source feed is in; both are joins, not stored membership.
 */
import { Hono } from "hono";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import { currentUser } from "../lib/user.js";

export const bookmarks = new Hono();

bookmarks.get("/", async (c) => {
  const user = currentUser(c);
  const limit = Math.min(100, Math.max(1, Number(c.req.query("limit") ?? 40)));
  const before = c.req.query("before"); // "<iso>|<id>"
  const feedId = c.req.query("feed") ? Number(c.req.query("feed")) : null;
  const collectionId = c.req.query("collection") ? Number(c.req.query("collection")) : null;

  let cursor = sql``;
  if (before) {
    const [ts, id] = before.split("|");
    cursor = sql`and (b.saved_at, b.id) < (${ts}::timestamptz, ${Number(id)}::bigint)`;
  }
  const feedFilter = feedId ? sql`and b.feed_id = ${feedId}` : sql``;
  const collectionFilter = collectionId
    ? sql`and b.feed_id in (
        with recursive tree as (select id from collections where id = ${collectionId} and user_id = ${user.id}
                                union all select c.id from collections c join tree t on c.parent_id = t.id)
        select cf.feed_id from collection_feeds cf join tree on tree.id = cf.collection_id)`
    : sql``;

  const rows = await db.execute(sql`
    select b.id, b.item_id as "itemId", b.feed_id as "feedId", b.url, b.title, b.summary, b.image_url as "imageUrl",
           b.site_title as "siteTitle", b.author, b.published_at as "publishedAt", b.note, b.saved_at as "savedAt",
           exists(select 1 from feed_icons fi where fi.feed_id = b.feed_id and not fi.generic) as "hasIcon"
    from bookmarks b
    where b.user_id = ${user.id} ${feedFilter} ${collectionFilter} ${cursor}
    order by b.saved_at desc, b.id desc
    limit ${limit + 1}
  `);
  const all = rows.rows as any[];
  const page = all.slice(0, limit);
  const last = all.length > limit ? page[page.length - 1] : null;
  return c.json({ bookmarks: page, nextCursor: last ? `${new Date(last.savedAt).toISOString()}|${last.id}` : null });
});

/** Distinct sources present in the user's bookmarks, for the filter UI. */
bookmarks.get("/sources", async (c) => {
  const user = currentUser(c);
  const feeds = await db.execute(sql`
    select b.feed_id as "feedId", coalesce(f.title, b.site_title) as title, count(*)::int as count
    from bookmarks b left join feeds f on f.id = b.feed_id
    where b.user_id = ${user.id} and b.feed_id is not null
    group by b.feed_id, coalesce(f.title, b.site_title) order by 3 desc, 2
  `);
  const collections = await db.execute(sql`
    select col.id, col.name, count(distinct b.id)::int as count
    from bookmarks b
    join collection_feeds cf on cf.feed_id = b.feed_id
    join collections col on col.id = cf.collection_id and col.user_id = ${user.id} and col.parent_id is not null
    where b.user_id = ${user.id}
    group by col.id, col.name order by 3 desc, 2
  `);
  return c.json({ feeds: feeds.rows, collections: collections.rows });
});

/**
 * Save. Body: { itemId } to snapshot a river item, { bookmarkId } to copy
 * someone's public bookmark (snapshot and all), or { url, title? } for anything
 * else. Idempotent per URL.
 */
bookmarks.post("/", async (c) => {
  const user = currentUser(c);
  const body = await c.req.json<{ itemId?: number; bookmarkId?: number; url?: string; title?: string; note?: string }>().catch(() => ({} as any));
  let values: typeof schema.bookmarks.$inferInsert;
  if (body.bookmarkId) {
    const rows = await db.execute<typeof schema.bookmarks.$inferSelect>(sql`
      select b.* from bookmarks b join users u on u.id = b.user_id
      where b.id = ${body.bookmarkId} and (b.user_id = ${user.id} or (u.profile_visibility = 'public' and u.show_bookmarks))
    `);
    const src = rows.rows[0] as any;
    if (!src) return c.json({ error: "bookmark not found" }, 404);
    values = { userId: user.id, itemId: src.item_id, feedId: src.feed_id, url: src.url, title: src.title, summary: src.summary, imageUrl: src.image_url, siteTitle: src.site_title, author: src.author, publishedAt: src.published_at ? new Date(src.published_at) : null, note: body.note ?? null };
  } else if (body.itemId) {
    const [row] = await db
      .select({ item: schema.items, feedTitle: schema.feeds.title })
      .from(schema.items)
      .innerJoin(schema.feeds, eq(schema.feeds.id, schema.items.feedId))
      .where(eq(schema.items.id, body.itemId));
    if (!row) return c.json({ error: "item not found" }, 404);
    const it = row.item;
    if (!it.url) return c.json({ error: "item has no link to save" }, 400);
    values = { userId: user.id, itemId: it.id, feedId: it.feedId, url: it.url, title: it.title, summary: it.summary, imageUrl: it.imageUrl, siteTitle: row.feedTitle, author: it.author, publishedAt: new Date(it.publishedAt as unknown as string), note: body.note ?? null };
  } else if (body.url) {
    values = { userId: user.id, url: body.url.trim(), title: body.title ?? null, note: body.note ?? null };
  } else {
    return c.json({ error: "itemId or url is required" }, 400);
  }
  const [saved] = await db
    .insert(schema.bookmarks)
    .values(values)
    .onConflictDoUpdate({ target: [schema.bookmarks.userId, schema.bookmarks.url], set: { savedAt: new Date() } })
    .returning();
  return c.json(saved, 201);
});

bookmarks.delete("/:id", async (c) => {
  const user = currentUser(c);
  const id = Number(c.req.param("id"));
  const [removed] = await db.delete(schema.bookmarks).where(and(eq(schema.bookmarks.id, id), eq(schema.bookmarks.userId, user.id))).returning();
  return removed ? c.json(removed) : c.json({ error: "not found" }, 404);
});
