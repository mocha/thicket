/**
 * Bookmarks: one private set per user. Saved from a river item (snapshot taken
 * at save time) or from a bare URL. Filterable by source feed or by any
 * collection the source feed is in; both are joins, not stored membership.
 *
 * A bookmark can carry my note on the post (issue #84), so this is also where
 * my notes are listed: `notes=1` narrows the list to the noted ones. The list
 * runs newest activity first: a post moves up when I save it, and again when I
 * write or edit its note.
 */
import { allowsSql } from "../lib/visibility.js";
import { Hono } from "hono";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import { currentUser } from "../lib/user.js";
import { cleanNote, noteOf, snapshotOfItem } from "../lib/bookmarks.js";
import { noteJson, othersNotesSql } from "../lib/notes.js";

export const bookmarks = new Hono();

/** When a bookmark last saw activity: saved, or its note written or edited. What the lists sort on. */
export const activeAtSql = sql`greatest(b.saved_at, coalesce(b.note_updated_at, b.saved_at))`;

bookmarks.get("/", async (c) => {
  const user = currentUser(c);
  const limit = Math.min(100, Math.max(1, Number(c.req.query("limit") ?? 40)));
  const before = c.req.query("before"); // "<iso>|<id>"
  const feedId = c.req.query("feed") ? Number(c.req.query("feed")) : null;
  const collectionId = c.req.query("collection") ? Number(c.req.query("collection")) : null;
  const notedOnly = c.req.query("notes") === "1";

  let cursor = sql``;
  if (before) {
    const [ts, id] = before.split("|");
    cursor = sql`and (${activeAtSql}, b.id) < (${ts}::timestamptz, ${Number(id)}::bigint)`;
  }
  const feedFilter = feedId ? sql`and b.feed_id = ${feedId}` : sql``;
  const collectionFilter = collectionId
    ? sql`and b.feed_id in (
        with recursive tree as (select id from collections where id = ${collectionId} and user_id = ${user.id}
                                union all select c.id from collections c join tree t on c.parent_id = t.id)
        select cf.feed_id from collection_feeds cf join tree on tree.id = cf.collection_id)`
    : sql``;
  const noteFilter = notedOnly ? sql`and b.note is not null` : sql``;

  const rows = await db.execute(sql`
    select b.id, b.item_id as "itemId", b.feed_id as "feedId", b.url, b.title, b.summary, b.image_url as "imageUrl",
           b.site_title as "siteTitle", b.author, b.published_at as "publishedAt", b.saved_at as "savedAt",
           ${activeAtSql} as "activeAt",
           case when b.note is null then null else ${noteJson("b")} end as note,
           ${othersNotesSql(user.id, sql`b.url`, sql`b.item_id`)} as notes,
           exists(select 1 from feed_icons fi where fi.feed_id = b.feed_id and not fi.generic) as "hasIcon",
           i.link_url as "linkUrl", i.link_label as "linkLabel"
    from bookmarks b
    left join items i on i.id = b.item_id
    where b.user_id = ${user.id} ${feedFilter} ${collectionFilter} ${noteFilter} ${cursor}
    order by ${activeAtSql} desc, b.id desc
    limit ${limit + 1}
  `);
  const all = rows.rows as any[];
  const page = all.slice(0, limit);
  const last = all.length > limit ? page[page.length - 1] : null;
  return c.json({ bookmarks: page, nextCursor: last ? `${new Date(last.activeAt).toISOString()}|${last.id}` : null });
});

/** Distinct sources present in the user's bookmarks, for the filter UI, and how many carry a note. */
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
  const [{ noted }] = (await db.execute<{ noted: number }>(sql`select count(*)::int as noted from bookmarks where user_id = ${user.id} and note is not null`)).rows;
  return c.json({ feeds: feeds.rows, collections: collections.rows, noted });
});

type Restore = {
  itemId: number | null; feedId: number | null; url: string; title: string | null; summary: string | null; imageUrl: string | null;
  siteTitle: string | null; author: string | null; publishedAt: string | null; savedAt: string;
  note: string | null; noteCreatedAt: string | null; noteUpdatedAt: string | null;
};
const when = (v: string | null | undefined) => (v ? new Date(v) : null);

/**
 * Save. Body: { itemId } to snapshot a river item, { bookmarkId } to copy
 * someone's public bookmark (snapshot, not their note), { url, title? } for
 * anything else, or { restore } with a bookmark exactly as DELETE returned it,
 * to undo a removal note and all. Idempotent per URL.
 */
bookmarks.post("/", async (c) => {
  const user = currentUser(c);
  const body = await c.req.json<{ itemId?: number; bookmarkId?: number; url?: string; title?: string; restore?: Restore }>().catch(() => ({} as any));
  let values: typeof schema.bookmarks.$inferInsert;
  if (body.restore) {
    const r = body.restore;
    if (!r.url) return c.json({ error: "url is required" }, 400);
    const note = r.note ? cleanNote(r.note) : null;
    if (note && "error" in note) return c.json({ error: note.error }, 400);
    values = {
      userId: user.id, itemId: r.itemId, feedId: r.feedId, url: r.url, title: r.title, summary: r.summary, imageUrl: r.imageUrl,
      siteTitle: r.siteTitle, author: r.author, publishedAt: when(r.publishedAt), savedAt: when(r.savedAt) ?? new Date(),
      note: note?.body ?? null, noteCreatedAt: note ? when(r.noteCreatedAt) ?? new Date() : null, noteUpdatedAt: note ? when(r.noteUpdatedAt) ?? new Date() : null,
    };
  } else if (body.bookmarkId) {
    const rows = await db.execute<typeof schema.bookmarks.$inferSelect>(sql`
      select b.* from bookmarks b join users u on u.id = b.user_id
      where b.id = ${body.bookmarkId} and (b.user_id = ${user.id} or (u.profile_visibility = 'public' and ${allowsSql("u.bookmarks_visibility", "u.id", user.id)}))
    `);
    const src = rows.rows[0] as any;
    if (!src) return c.json({ error: "bookmark not found" }, 404);
    values = { userId: user.id, itemId: src.item_id, feedId: src.feed_id, url: src.url, title: src.title, summary: src.summary, imageUrl: src.image_url, siteTitle: src.site_title, author: src.author, publishedAt: src.published_at ? new Date(src.published_at) : null };
  } else if (body.itemId) {
    const snap = await snapshotOfItem(user.id, body.itemId);
    if (!snap) return c.json({ error: "item not found" }, 404);
    values = snap;
  } else if (body.url) {
    values = { userId: user.id, url: body.url.trim(), title: body.title ?? null };
  } else {
    return c.json({ error: "itemId or url is required" }, 400);
  }
  const [saved] = await db
    .insert(schema.bookmarks)
    .values(values)
    .onConflictDoUpdate({ target: [schema.bookmarks.userId, schema.bookmarks.url], set: { savedAt: values.savedAt ?? new Date() } })
    .returning();
  return c.json(saved, 201);
});

/** Remove a bookmark, and the note on it with it. Returns what was removed, so it can be restored. */
bookmarks.delete("/:id", async (c) => {
  const user = currentUser(c);
  const id = Number(c.req.param("id"));
  const [removed] = await db.delete(schema.bookmarks).where(and(eq(schema.bookmarks.id, id), eq(schema.bookmarks.userId, user.id))).returning();
  return removed ? c.json(removed) : c.json({ error: "not found" }, 404);
});

/**
 * Write or rewrite the note on one of my bookmarks. The same as noting the
 * post, for a bookmark whose post is gone or was saved from a bare address.
 */
bookmarks.put("/:id/note", async (c) => {
  const user = currentUser(c);
  const id = Number(c.req.param("id"));
  const payload = await c.req.json<{ body?: string }>().catch(() => ({} as { body?: string }));
  const clean = cleanNote(payload.body);
  if ("error" in clean) return c.json({ error: clean.error }, 400);
  const [row] = await db.update(schema.bookmarks)
    .set({ note: clean.body, noteCreatedAt: sql`coalesce(${schema.bookmarks.noteCreatedAt}, now())`, noteUpdatedAt: sql`now()` })
    .where(and(eq(schema.bookmarks.id, id), eq(schema.bookmarks.userId, user.id)))
    .returning();
  if (!row) return c.json({ error: "not found" }, 404);
  const note = noteOf(row)!;
  return c.json({ ...note, bookmarkId: row.id }, note.createdAt === note.updatedAt ? 201 : 200);
});

/** Delete the note on one of my bookmarks. The bookmark stays. */
bookmarks.delete("/:id/note", async (c) => {
  const user = currentUser(c);
  const id = Number(c.req.param("id"));
  await db.update(schema.bookmarks)
    .set({ note: null, noteCreatedAt: null, noteUpdatedAt: null })
    .where(and(eq(schema.bookmarks.id, id), eq(schema.bookmarks.userId, user.id)));
  return c.body(null, 204);
});
