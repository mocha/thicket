/**
 * A single post: what it is, and — separately — its body.
 *
 * The two are split on purpose. What a post *is* (title, who published it,
 * when, where it lives) is the publisher's own shopfront copy and is readable
 * by anyone, which is what lets a link to a post work for the person you sent
 * it to. The body, made safe for the in-app reader, is signed-in readers only:
 * showing a publisher's text inside another site is a different thing from
 * linking to it, and it is offered to members, not to the open web.
 */
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { currentUser } from "../lib/user.js";
import { noteColumns } from "../lib/notes.js";
import { feedSlugSql } from "../lib/slug.js";
import { looksPartial, sanitizeContent, textOf } from "../lib/sanitize.js";

export const items = new Hono();

/**
 * One post, shaped like a river item so the reader renders it the same whether
 * it was clicked in a list or arrived cold from its own address. The feed's
 * slug rides along because the address is /feeds/:id/:slug/:item/:itemslug and
 * whoever loads it may only have the ids.
 */
items.get("/:id", async (c) => {
  const user = c.get("user");
  const userId = user?.id ?? -1;
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "not found" }, 404);
  const rows = await db.execute(sql`
    select i.id, i.feed_id as "feedId", coalesce(fs.display_name, f.title) as "feedTitle", f.site_url as "siteUrl",
           ${feedSlugSql} as "feedSlug",
           i.url, i.title, i.author, i.summary, i.link_url as "linkUrl", i.link_label as "linkLabel", i.image_url as "imageUrl", i.published_at as "publishedAt",
           exists(select 1 from feed_icons fi where fi.feed_id = i.feed_id and not fi.generic) as "hasIcon",
           (select bm.id from bookmarks bm where bm.user_id = ${userId} and bm.item_id = i.id limit 1) as "bookmarkId",
           ${noteColumns(userId)}
    from items i
    join feeds f on f.id = i.feed_id
    left join feed_settings fs on fs.user_id = ${userId} and fs.feed_id = i.feed_id
    where i.id = ${id}
  `);
  const row = rows.rows[0] as (Record<string, unknown> & { publishedAt: string }) | undefined;
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json({ ...row, publishedAt: new Date(row.publishedAt).toISOString() });
});

items.get("/:id/content", async (c) => {
  currentUser(c);
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "not found" }, 404);
  const rows = await db.execute<{
    id: number; feedId: number; url: string | null; title: string | null; author: string | null; content: string | null;
    publishedAt: string; feedTitle: string | null; siteUrl: string | null; feedUrl: string;
    typicalLength: number | null;
  }>(sql`
    select i.id, i.feed_id as "feedId", i.url, i.title, i.author, i.content, i.published_at as "publishedAt",
           f.title as "feedTitle", f.site_url as "siteUrl", f.url as "feedUrl",
           (select percentile_cont(0.5) within group (order by length(regexp_replace(coalesce(s.content, ''), '<[^>]*>', ' ', 'g')))
              from (select o.content from items o where o.feed_id = i.feed_id order by o.published_at desc limit 40) s) as "typicalLength"
    from items i join feeds f on f.id = i.feed_id
    where i.id = ${id}
  `);
  const row = rows.rows[0];
  if (!row) return c.json({ error: "not found" }, 404);

  const base = row.url ?? row.siteUrl ?? row.feedUrl;
  const raw = row.content ?? "";
  const clean = sanitizeContent(raw, base);
  const text = textOf(clean.html);
  const typical = row.typicalLength === null ? null : Math.round(Number(row.typicalLength));
  c.header("cache-control", "private, max-age=300");
  return c.json({
    id: row.id, feedId: row.feedId, url: row.url, title: row.title, author: row.author, publishedAt: new Date(row.publishedAt).toISOString(),
    feedTitle: row.feedTitle, siteUrl: row.siteUrl,
    html: clean.html, hasImages: clean.hasImages, textLength: text.length, typicalLength: typical,
    partial: looksPartial(text, base),
  });
});
