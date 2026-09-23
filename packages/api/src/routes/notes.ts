/**
 * Notes: one Markdown note per (me, post), written from any card anywhere,
 * including posts in feeds and collections I don't follow. A note is part of
 * my bookmark of the post (issue #84): writing one saves the post if it isn't
 * saved yet, and deleting it leaves the bookmark. Edit replaces the body and
 * moves updated_at; created_at stays as the moment I first wrote it.
 *
 * These verbs name the post. A bookmark whose post is gone is noted through
 * /api/bookmarks/:id/note instead.
 */
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { currentUser } from "../lib/user.js";
import { cleanNote, snapshotOfItem } from "../lib/bookmarks.js";
import { postAddressSql } from "../lib/notes.js";

export const notes = new Hono();

/** Write or rewrite my note on a post. Body: { body }. Empty body is a 400; deleting is its own verb. */
notes.put("/items/:itemId", async (c) => {
  const user = currentUser(c);
  const itemId = Number(c.req.param("itemId"));
  const payload = await c.req.json<{ body?: string }>().catch(() => ({} as { body?: string }));
  const clean = cleanNote(payload.body);
  if ("error" in clean) return c.json({ error: clean.error }, 400);
  const snap = await snapshotOfItem(user.id, itemId);
  if (!snap) return c.json({ error: "not found" }, 404);
  // Saving the note saves the post: a new bookmark, or the note added to the
  // one I already have. `created` is whether the note is new, not the bookmark.
  const [row] = (await db.execute<{ id: number; body: string; createdAt: string; updatedAt: string; created: boolean }>(sql`
    insert into bookmarks (user_id, item_id, feed_id, url, title, summary, image_url, site_title, author, published_at, note, note_created_at, note_updated_at)
    values (${snap.userId}, ${snap.itemId}, ${snap.feedId}, ${snap.url}, ${snap.title}, ${snap.summary}, ${snap.imageUrl}, ${snap.siteTitle}, ${snap.author}, ${snap.publishedAt}, ${clean.body}, now(), now())
    on conflict (user_id, url) do update set
      note = excluded.note,
      note_created_at = coalesce(bookmarks.note_created_at, now()),
      note_updated_at = now()
    returning id, note as body, note_created_at as "createdAt", note_updated_at as "updatedAt", (note_created_at = note_updated_at) as created
  `)).rows;
  return c.json({ id: row.id, body: row.body, createdAt: new Date(row.createdAt).toISOString(), updatedAt: new Date(row.updatedAt).toISOString(), bookmarkId: row.id }, row.created ? 201 : 200);
});

/** Delete my note on a post. The bookmark stays. */
notes.delete("/items/:itemId", async (c) => {
  const user = currentUser(c);
  const itemId = Number(c.req.param("itemId"));
  await db.execute(sql`
    update bookmarks set note = null, note_created_at = null, note_updated_at = null
    where user_id = ${user.id} and url = (select ${postAddressSql} from items i join feeds f on f.id = i.feed_id where i.id = ${itemId})
  `);
  return c.body(null, 204);
});
