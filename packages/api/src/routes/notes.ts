/**
 * Notes: one Markdown note per (me, post). Written from any card anywhere,
 * including posts in feeds and collections I don't follow. Edit replaces the
 * body and moves updated_at; created_at stays as the moment I first wrote it.
 * GET / is My Notes: the posts I have noted, newest note first, in river shape.
 */
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { currentUser } from "../lib/user.js";
import { NOTE_MAX, noteColumns } from "../lib/notes.js";
import { feedSlugSql } from "../lib/slug.js";

export const notes = new Hono();

notes.get("/", async (c) => {
  const user = currentUser(c);
  const limit = Math.min(100, Math.max(1, Number(c.req.query("limit") ?? 30)));
  const before = c.req.query("before"); // "<iso>|<noteId>"
  let cursor = sql``;
  if (before) {
    const [ts, id] = before.split("|");
    cursor = sql`and (mine.created_at, mine.id) < (${ts}::timestamptz, ${Number(id)}::bigint)`;
  }
  const rows = await db.execute<any>(sql`
    select i.id, i.feed_id as "feedId", f.title as "feedTitle", f.site_url as "siteUrl", ${feedSlugSql} as "feedSlug",
           i.url, i.title, i.author, i.summary, i.image_url as "imageUrl", i.published_at as "publishedAt",
           exists(select 1 from feed_icons fi where fi.feed_id = i.feed_id and not fi.generic) as "hasIcon",
           (select bm.id from bookmarks bm where bm.user_id = ${user.id} and bm.item_id = i.id limit 1) as "bookmarkId",
           mine.id as "noteId", mine.created_at as "notedAt",
           ${noteColumns(user.id)}
    from notes mine
    join items i on i.id = mine.item_id
    join feeds f on f.id = i.feed_id
    where mine.user_id = ${user.id} ${cursor}
    order by mine.created_at desc, mine.id desc
    limit ${limit + 1}
  `);
  const all = rows.rows;
  const page = all.slice(0, limit);
  const last = all.length > limit ? page[page.length - 1] : null;
  return c.json({
    items: page.map(({ noteId, notedAt, ...r }: any) => ({ ...r, publishedAt: new Date(r.publishedAt).toISOString() })),
    nextCursor: last ? `${new Date(last.notedAt).toISOString()}|${last.noteId}` : null,
  });
});

/** How many posts I have noted; the nav and profile can show it. */
notes.get("/count", async (c) => {
  const user = currentUser(c);
  const [{ count }] = (await db.execute<{ count: number }>(sql`select count(*)::int as count from notes where user_id = ${user.id}`)).rows;
  return c.json({ count });
});

/** Write or rewrite my note on a post. Body: { body }. Empty body is a 400; deleting is its own verb. */
notes.put("/items/:itemId", async (c) => {
  const user = currentUser(c);
  const itemId = Number(c.req.param("itemId"));
  const payload = await c.req.json<{ body?: string }>().catch(() => ({} as { body?: string }));
  const body = (payload.body ?? "").replace(/\r\n/g, "\n").trim();
  if (!body) return c.json({ error: "Write something first." }, 400);
  if (body.length > NOTE_MAX) return c.json({ error: `Notes are at most ${NOTE_MAX} characters; this one is ${body.length}.` }, 400);
  const exists = await db.execute(sql`select 1 from items where id = ${itemId}`);
  if (!exists.rows.length) return c.json({ error: "not found" }, 404);
  const [row] = (await db.execute<{ id: number; body: string; createdAt: string; updatedAt: string; created: boolean }>(sql`
    insert into notes (user_id, item_id, body) values (${user.id}, ${itemId}, ${body})
    on conflict (user_id, item_id) do update set body = excluded.body, updated_at = now()
    returning id, body, created_at as "createdAt", updated_at as "updatedAt", (xmax = 0) as created
  `)).rows;
  return c.json({ id: row.id, body: row.body, createdAt: new Date(row.createdAt).toISOString(), updatedAt: new Date(row.updatedAt).toISOString() }, row.created ? 201 : 200);
});

notes.delete("/items/:itemId", async (c) => {
  const user = currentUser(c);
  const itemId = Number(c.req.param("itemId"));
  await db.execute(sql`delete from notes where user_id = ${user.id} and item_id = ${itemId}`);
  return c.body(null, 204);
});
