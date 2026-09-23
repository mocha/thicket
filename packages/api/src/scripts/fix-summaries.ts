/**
 * Bring already-stored posts in line with feeds/parse.ts's handling of a
 * description that is nothing but a link. Hacker News hands each post a
 * description that is a single "Comments" link to the discussion thread, so
 * every stored HN post ended up with the bare word "Comments" as its summary
 * and the thread link thrown away. "Read more" and a bare "Permalink" have the
 * same shape. The parser now drops such a summary and, when the link points
 * somewhere other than the post itself, keeps it (link_url / link_label) to
 * show on the card. This does the same to the back catalogue. No network. Run
 * alone with `pnpm fix-summaries [--dry]`; in production,
 * `node dist/scripts/fix-summaries.js`.
 *
 * Safe and idempotent: it only touches a post whose kept body (`content`) is
 * entirely link text, and only clears a summary that is null already or is
 * exactly that link's words — so a real summary (e.g. a media description) is
 * never lost. It keeps the link only when it is absolute and goes somewhere
 * other than the post's own URL.
 */
import { sql } from "drizzle-orm";
import { db, pool } from "../db/client.js";
import { isLinkOnly, linkOnly, stripHtml } from "../feeds/parse.js";

const dry = process.argv.includes("--dry");
const BATCH = 2000;
const norm = (u: string | null) => (u ?? "").replace(/\/+$/, "");

let after = 0, seen = 0, cleared = 0, linked = 0, bmCleared = 0;
const samples: string[] = [];

for (;;) {
  // A link-only description is tiny, so the length cap skips full article
  // bodies (which also hold links) cheaply; the real test runs in JS.
  const rows = (await db.execute<{ id: number; url: string | null; summary: string | null; content: string; linkUrl: string | null; linkLabel: string | null }>(sql`
    select id, url, summary, content, link_url as "linkUrl", link_label as "linkLabel" from items
    where id > ${after} and content is not null and length(content) < 2000 and content ~* '<a[ >]'
    order by id limit ${BATCH}`)).rows;
  if (!rows.length) break;
  for (const r of rows) {
    seen++;
    after = Number(r.id);
    if (!isLinkOnly(r.content)) continue;
    const l = linkOnly(r.content);
    // Leave a summary that came from somewhere other than this link.
    if (r.summary !== null && (!l || stripHtml(r.content) !== r.summary)) continue;
    // A bookmark keeps its own copy of the summary from when it was saved. Ones
    // saved before this fix still hold the bare word ("Comments"); clear them so
    // the card shows only the kept link. New bookmarks copy the item's now-null
    // summary, so this is only for the back catalogue.
    if (!dry) bmCleared += (await db.execute(sql`update bookmarks set summary = null where item_id = ${r.id} and summary is not null`)).rowCount ?? 0;
    const url = l && /^https?:\/\//i.test(l.url) && norm(l.url) !== norm(r.url) ? l.url : null;
    const label = url ? l!.label : null;
    cleared++;
    if (url) linked++;
    if (samples.length < 5) samples.push(`#${r.id}: “${r.summary ?? "∅"}” → ${url ? `link “${label}” → ${url}` : "(none)"}`);
    // Clear the summary, keep the link, and drop the link-only body: leaving it
    // would keep feeding search the bare word ("Comments"). Once content is
    // null the row no longer matches the filter, so this is safe to re-run.
    if (!dry) await db.execute(sql`update items set summary = null, link_url = ${url}, link_label = ${label}, content = null where id = ${r.id}`);
  }
  console.log(`  ${seen} looked at, ${cleared} fixed (${linked} kept a link)`);
}

console.log(`${dry ? "dry run: " : ""}${cleared} posts fixed, ${linked} kept a link, ${bmCleared} stale bookmark summaries cleared`);
for (const s of samples) console.log(`  ${s}`);
await pool.end();
