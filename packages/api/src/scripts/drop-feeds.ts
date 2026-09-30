/**
 * Take feeds out of the index that a seed put there and that turned out not
 * to belong — a file of feed URLs, one per line, "#" for comments (the same
 * shape `pnpm ingest` reads).
 *
 *   pnpm drop-feeds seeds/dropped-2026-09-30.txt            → list what would go
 *   pnpm drop-feeds seeds/dropped-2026-09-30.txt --apply    → remove it
 *
 * A feed anyone follows stays: it is theirs now, not the seed's. So does one
 * someone has bookmarked a post from. Both are listed as kept, with the reason.
 */
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { db, pool } from "../db/client.js";
import { normalizeFeedUrl } from "../feeds/normalize.js";
import { otherScheme } from "../feeds/twins.js";

const file = process.argv.slice(2).find((a) => !a.startsWith("--"));
const apply = process.argv.includes("--apply");
if (!file) {
  console.error("usage: pnpm drop-feeds <file of feed urls> [--apply]");
  process.exit(1);
}

const urls = new Set<string>();
for (const raw of readFileSync(file, "utf8").split("\n")) {
  const line = raw.replace(/\s+#.*$/, "").trim();
  if (!line || line.startsWith("#")) continue;
  try {
    const url = normalizeFeedUrl(line);
    urls.add(url);
    const flipped = otherScheme(url);
    if (flipped) urls.add(flipped);
  } catch { /* not a URL; nothing in the index can match it */ }
}

const rows = urls.size ? (await db.execute<{ id: number; title: string | null; url: string; followers: number; bookmarks: number }>(sql`
  select f.id, f.title, f.url,
    (select count(*)::int from collection_feeds cf where cf.feed_id = f.id) as followers,
    (select count(*)::int from bookmarks b where b.feed_id = f.id) as bookmarks
  from feeds f where f.url in (${sql.join([...urls].map((u) => sql`${u}`), sql`, `)}) order by f.title`)).rows : [];

let dropped = 0;
for (const r of rows) {
  const name = `#${r.id} ${r.title ?? "(untitled)"} <${r.url}>`;
  if (r.followers || r.bookmarks) {
    console.log(`keep ${name}: ${r.followers ? `in ${r.followers} ${r.followers === 1 ? "collection" : "collections"}` : `${r.bookmarks} ${r.bookmarks === 1 ? "bookmark" : "bookmarks"}`}`);
    continue;
  }
  console.log(`drop ${name}`);
  if (apply) await db.execute(sql`delete from feeds where id = ${r.id}`);
  dropped++;
}

console.log(`\n${rows.length} of the listed feeds are in the index; ${dropped} ${apply ? "removed" : "would be removed (run with --apply)"}`);
await pool.end();
