/**
 * Fold together feeds that are already in the index twice (feeds/twins.ts):
 * the same address over http and https, or two addresses on one site that
 * publish the same posts. New feeds are checked as they arrive; this is for
 * the ones that got in before that check existed.
 *
 *   pnpm dedupe-feeds            → list the pairs it would fold, change nothing
 *   pnpm dedupe-feeds --apply    → fold them
 *
 * Folding keeps everything people did with either feed: collections, settings,
 * blocks, bookmarks and notes all move to the one that stays (feeds/merge.ts).
 */
import { sql } from "drizzle-orm";
import { db, pool } from "../db/client.js";
import { findTwin } from "../feeds/twins.js";
import { mergeFeeds } from "../feeds/merge.js";

const apply = process.argv.includes("--apply");

const ids = (await db.execute<{ id: number }>(sql`select id from feeds order by id`)).rows.map((r) => Number(r.id));
const gone = new Set<number>();
const reported = new Set<string>();
let pairs = 0;

const label = async (id: number) => {
  const [f] = (await db.execute<{ title: string | null; url: string }>(sql`select title, url from feeds where id = ${id}`)).rows;
  return f ? `#${id} ${f.title ?? "(untitled)"} <${f.url}>` : `#${id}`;
};

for (const id of ids) {
  if (gone.has(id)) continue;
  const twin = await findTwin(id);
  if (!twin) continue;
  const key = [twin.keep, twin.drop].sort((a, b) => a - b).join("-");
  if (reported.has(key)) continue;
  reported.add(key);
  pairs++;
  console.log(`${twin.why}\n  keep ${await label(twin.keep)}\n  fold ${await label(twin.drop)}`);
  if (apply) {
    await mergeFeeds(twin.drop, twin.keep, twin.why);
    gone.add(twin.drop);
  }
}

console.log(`\n${pairs} ${pairs === 1 ? "pair" : "pairs"} ${apply ? "folded" : "found; run with --apply to fold them"}`);
await pool.end();
