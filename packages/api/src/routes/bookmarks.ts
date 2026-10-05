/**
 * Bookmarks: one private set per user. Saved from a river item (snapshot taken
 * at save time) or from a bare URL. Filterable by any collection the source
 * feed is in; that is a join, not stored membership.
 *
 * A bookmark can carry my note on the post (issue #84), so this is also where
 * my notes are listed: `notes=1` narrows the list to the noted ones. The list
 * runs newest activity first: a post moves up when I save it, and again when I
 * write or edit its note.
 *
 * `q=` searches them (issue #98): the title, the summary, the site name, the
 * address and my note, through the full-text index in drizzle/0021. It narrows
 * the list like any other filter and combines with all of them; the order
 * stays newest activity first, because a search here is for finding a thing I
 * know I saved, not for ranking.
 */
import { allowsSql } from "../lib/visibility.js";
import { Hono } from "hono";
import { and, eq, sql, type SQL } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import { currentUser } from "../lib/user.js";
import { cleanNote, isSavedAddress, noteOf, snapshotOfItem } from "../lib/bookmarks.js";
import { noteJson, othersNotesSql } from "../lib/notes.js";
import { mentionsOf } from "../lib/mentions.js";
import { EXPORT_MAX, renderBookmarkFile, type ExportRow } from "../lib/bookmark-export.js";
import { isHttpUrl } from "../feeds/normalize.js";
import { fieldProblem } from "../lib/bookmark-fields.js";
import { LIMITS, hit, tooManyFor } from "../lib/ratelimit.js";

export const bookmarks = new Hono();

/**
 * What the daily limits say (LIMITS.savesPerDay, LIMITS.noteWritesPerDay). No
 * reader meets them; they are there so an account can't be used as storage.
 */
export const SAVED_ENOUGH = "That is a lot of saving for one day. It will work again tomorrow.";
export const NOTED_ENOUGH = "That is a lot of notes for one day. It will work again tomorrow.";

/** When a bookmark last saw activity: saved, or its note written or edited. What the lists sort on. */
export const activeAtSql = sql`greatest(b.saved_at, coalesce(b.note_updated_at, b.saved_at))`;

/**
 * Matched words come back fenced by two control characters rather than <mark>
 * tags, the same as routes/search.ts, so the page draws the highlight itself
 * and nothing saved from a publisher reaches the DOM as markup.
 */
const MARK_OPEN = "\u0001";
const MARK_CLOSE = "\u0002";
const HL_ALL = `StartSel=${MARK_OPEN}, StopSel=${MARK_CLOSE}, HighlightAll=true`;
/** A summary shows two lines on a card, so it is cut to the part around the match. */
const HL_PART = `StartSel=${MARK_OPEN}, StopSel=${MARK_CLOSE}, MaxWords=18, MinWords=8, ShortWord=3, MaxFragments=1`;
/** Longer than anyone types; keeps one request from handing Postgres a novel to parse. */
const QUERY_MAX = 200;

/**
 * The search as Postgres reads it: websearch_to_tsquery, as routes/search.ts
 * uses, so quotes, OR and a leading minus all work. Two differences, both
 * because this list narrows as I type:
 *
 * The last word also matches as the start of a word. Without that, "batt"
 * finds nothing until I finish typing "batteries".
 *
 * Something typed like an address is also tried as separate words. Postgres
 * reads "example.com" as one word, a host name, and that would miss a post
 * saved from www.example.com. A search that excludes words is left as typed.
 */
const asTyped = (q: string) => sql`(
  select case when numnode(w) > 0 then (w::text || ':*')::tsquery else w end
  from (select websearch_to_tsquery('english', ${q}) as w) typed)`;
function tsquerySql(q: string): SQL {
  const spaced = q.replace(/[./:_]+/g, " ").trim();
  if (spaced === q || /(^|\s)-/.test(q)) return asTyped(q);
  return sql`(${asTyped(q)} || ${asTyped(spaced)})`;
}

/** One field with the matched words fenced, or null when the match is not in it. */
const markedSql = (text: SQL, tsq: SQL, options: string) =>
  sql`(select case when position(${MARK_OPEN} in h) > 0 then h end
        from (select ts_headline('english', ${text}, ${tsq}, ${options}) as h) x)`;

bookmarks.get("/", async (c) => {
  const user = currentUser(c);
  const limit = Math.min(100, Math.max(1, Number(c.req.query("limit") ?? 40)));
  const before = c.req.query("before"); // "<iso>|<id>"
  const collectionId = c.req.query("collection") ? Number(c.req.query("collection")) : null;
  const notedOnly = c.req.query("notes") === "1";
  const q = (c.req.query("q") ?? "").trim().slice(0, QUERY_MAX);

  let cursor = sql``;
  if (before) {
    const [ts, id] = before.split("|");
    cursor = sql`and (${activeAtSql}, b.id) < (${ts}::timestamptz, ${Number(id)}::bigint)`;
  }
  const collectionFilter = collectionId
    ? sql`and b.feed_id in (
        with recursive tree as (select id from collections where id = ${collectionId} and user_id = ${user.id}
                                union all select c.id from collections c join tree t on c.parent_id = t.id)
        select cf.feed_id from collection_feeds cf join tree on tree.id = cf.collection_id)`
    : sql``;
  const noteFilter = notedOnly ? sql`and b.note is not null` : sql``;
  const tsq = tsquerySql(q);
  const searchFilter = q ? sql`and b.search @@ ${tsq}` : sql``;
  // Where the match is, for the page to mark. Only worked out for the rows sent.
  // A bookmark matches when all the words are somewhere in it, but each field
  // is marked for any of them: "colossal surreal" lights up the site name and
  // the note, though neither holds both words.
  const any = sql`(select replace(t::text, ' & ', ' | ')::tsquery from (select ${tsq} as t) whole)`;
  const marks = q
    ? sql`json_build_object(
        'title', ${markedSql(sql`coalesce(b.title, '')`, any, HL_ALL)},
        'site', ${markedSql(sql`coalesce(b.site_title, '')`, any, HL_ALL)},
        'summary', ${markedSql(sql`coalesce(b.summary, '')`, any, HL_PART)},
        'note', ${markedSql(sql`coalesce(b.note, '')`, any, HL_ALL)})`
    : sql`null`;

  const rows = await db.execute(sql`
    select b.id, b.item_id as "itemId", b.feed_id as "feedId", b.url, b.title, b.summary, b.image_url as "imageUrl",
           b.site_title as "siteTitle", b.author, b.published_at as "publishedAt", b.saved_at as "savedAt",
           ${activeAtSql} as "activeAt", ${marks} as marks,
           case when b.note is null then null else ${noteJson("b")} end as note,
           ${othersNotesSql(user.id, sql`b.url`, sql`b.item_id`)} as notes,
           exists(select 1 from feed_icons fi where fi.feed_id = b.feed_id and not fi.generic) as "hasIcon",
           i.link_url as "linkUrl", i.link_label as "linkLabel"
    from bookmarks b
    left join items i on i.id = b.item_id
    where b.user_id = ${user.id} ${collectionFilter} ${noteFilter} ${searchFilter} ${cursor}
    order by ${activeAtSql} desc, b.id desc
    limit ${limit + 1}
  `);
  const all = rows.rows as any[];
  const page = all.slice(0, limit);
  const last = all.length > limit ? page[page.length - 1] : null;
  return c.json({ bookmarks: page, nextCursor: last ? `${new Date(last.activeAt).toISOString()}|${last.id}` : null });
});

/** The collections my bookmarks come from, for the tabs, how many bookmarks there are in all, and how many carry a note. */
bookmarks.get("/sources", async (c) => {
  const user = currentUser(c);
  const collections = await db.execute(sql`
    select col.id, col.name, count(distinct b.id)::int as count
    from bookmarks b
    join collection_feeds cf on cf.feed_id = b.feed_id
    join collections col on col.id = cf.collection_id and col.user_id = ${user.id} and col.parent_id is not null
    where b.user_id = ${user.id}
    group by col.id, col.name order by 3 desc, 2
  `);
  const [{ total, noted }] = (await db.execute<{ total: number; noted: number }>(sql`
    select count(*)::int as total, count(note)::int as noted from bookmarks where user_id = ${user.id}`)).rows;
  return c.json({ collections: collections.rows, total, noted });
});

/** A stored row as save and remove answer with it. The search vector is the database's own business. */
const withoutSearch = <T extends { search: unknown }>({ search: _search, ...row }: T) => row;

/**
 * My bookmarks and notes as one file to keep or take elsewhere (issue #135):
 * the bookmark file browsers and bookmark services read. Always the whole
 * set, newest saved first, up to EXPORT_MAX of them, and for every account.
 * `tz` is the reader's timezone as their browser names it, for the times
 * written in each description; without a real one they are written in UTC.
 * Sent as a download, and told never to run as a page here (its own
 * stylesheet is all it may use): the text in it
 * is escaped, and this is the second lock on the same door.
 */
bookmarks.get("/export", async (c) => {
  const user = currentUser(c);
  const rows = await db.execute<ExportRow>(sql`
    select url, title, note, author, site_title as "siteTitle", published_at as "publishedAt", saved_at as "savedAt"
    from bookmarks where user_id = ${user.id}
    order by saved_at desc, id desc
    limit ${EXPORT_MAX}
  `);
  const file = renderBookmarkFile(rows.rows, { handle: user.handle, timeZone: c.req.query("tz") });
  c.header("content-type", "text/html; charset=utf-8");
  c.header("content-disposition", `attachment; filename="thicket-bookmarks-${new Date().toISOString().slice(0, 10)}.html"`);
  c.header("content-security-policy", "sandbox; default-src 'none'; style-src 'unsafe-inline'");
  c.header("x-content-type-options", "nosniff");
  c.header("cache-control", "no-store");
  return c.body(file);
});

/** What an export would hold: how many bookmarks I have, and the most one file carries. For the Account page. */
bookmarks.get("/export/info", async (c) => {
  const user = currentUser(c);
  const [{ count }] = (await db.execute<{ count: number }>(sql`select count(*)::int as count from bookmarks where user_id = ${user.id}`)).rows;
  return c.json({ count, limit: EXPORT_MAX });
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
    // The address comes back from the page, so it gets the same check as any
    // saved address: a web address, or a post's page here.
    const problem = fieldProblem(r);
    if (problem) return c.json({ error: problem }, 400);
    if (!r.url || !isSavedAddress(r.url)) return c.json({ error: "only http(s) URLs or a post's page here" }, 400);
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
      where b.id = ${body.bookmarkId} and (b.user_id = ${user.id} or (u.profile_visibility = 'public' and (
        ${allowsSql("u.bookmarks_visibility", "u.id", user.id)}
        -- Shown to me because I may read their notes: a noted post is on their page for me, so I can save it.
        or (b.note is not null and ${allowsSql("u.notes_visibility", "u.id", user.id)}))))
    `);
    const src = rows.rows[0] as any;
    if (!src) return c.json({ error: "bookmark not found" }, 404);
    values = { userId: user.id, itemId: src.item_id, feedId: src.feed_id, url: src.url, title: src.title, summary: src.summary, imageUrl: src.image_url, siteTitle: src.site_title, author: src.author, publishedAt: src.published_at ? new Date(src.published_at) : null };
  } else if (body.itemId) {
    const snap = await snapshotOfItem(user.id, body.itemId);
    if (!snap) return c.json({ error: "item not found" }, 404);
    values = snap;
  } else if (body.url) {
    // A bookmark is a clickable card others may see, so only ever a web address.
    const problem = fieldProblem({ url: body.url, title: body.title });
    if (problem) return c.json({ error: problem }, 400);
    const url = body.url.trim();
    if (!isHttpUrl(url)) return c.json({ error: "only http(s) URLs" }, 400);
    values = { userId: user.id, url, title: body.title ?? null };
  } else {
    return c.json({ error: "itemId or url is required" }, 400);
  }
  // Counted once it is known to be a real save, so a mistyped address costs nothing.
  const pace = hit(`saves:${user.id}`, LIMITS.savesPerDay);
  if (!pace.ok) return tooManyFor(c, pace.retryAfterS, SAVED_ENOUGH);
  const [saved] = await db
    .insert(schema.bookmarks)
    .values(values)
    .onConflictDoUpdate({ target: [schema.bookmarks.userId, schema.bookmarks.url], set: { savedAt: values.savedAt ?? new Date() } })
    .returning();
  return c.json(withoutSearch(saved), 201);
});

/** Remove a bookmark, and the note on it with it. Returns what was removed, so it can be restored. */
bookmarks.delete("/:id", async (c) => {
  const user = currentUser(c);
  const id = Number(c.req.param("id"));
  const [removed] = await db.delete(schema.bookmarks).where(and(eq(schema.bookmarks.id, id), eq(schema.bookmarks.userId, user.id))).returning();
  return removed ? c.json(withoutSearch(removed)) : c.json({ error: "not found" }, 404);
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
  const pace = hit(`notes:${user.id}`, LIMITS.noteWritesPerDay);
  if (!pace.ok) return tooManyFor(c, pace.retryAfterS, NOTED_ENOUGH);
  const [row] = await db.update(schema.bookmarks)
    .set({ note: clean.body, noteCreatedAt: sql`coalesce(${schema.bookmarks.noteCreatedAt}, now())`, noteUpdatedAt: sql`now()` })
    .where(and(eq(schema.bookmarks.id, id), eq(schema.bookmarks.userId, user.id)))
    .returning();
  if (!row) return c.json({ error: "not found" }, 404);
  const note = noteOf(row)!;
  return c.json({ ...note, mentions: await mentionsOf(note.body), bookmarkId: row.id }, note.createdAt === note.updatedAt ? 201 : 200);
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
