/**
 * Recompute every post's card picture from what is already stored, with the
 * rules in feeds/images.ts: a declared thumbnail under 100 pixels gives way to
 * the body's first image, and known hosts are asked for the large version.
 * No network. Run alone with `pnpm fix-previews [--dry]`; in production,
 * `node dist/scripts/fix-previews.js`.
 *
 * The stored image_url is whatever the parser chose at the time, so it is
 * treated as the declared picture here: if it is small, the body's first
 * image stands in, exactly as a fresh parse would now decide.
 */
import { sql } from "drizzle-orm";
import { db, pool } from "../db/client.js";
import { choosePreview } from "../feeds/images.js";

const dry = process.argv.includes("--dry");
const BATCH = 2000;
let after = 0, seen = 0, changed = 0, swapped = 0, upsized = 0;
const hosts = new Map<string, number>();
const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return "?"; } };
const fileOf = (u: string) => u.split("?")[0].split("/").pop() ?? "";

for (;;) {
  const rows = (await db.execute<{ id: number; url: string | null; imageUrl: string; content: string | null }>(sql`
    select id, url, image_url as "imageUrl", content from items where image_url is not null and id > ${after} order by id limit ${BATCH}`)).rows;
  if (!rows.length) break;
  for (const r of rows) {
    seen++;
    after = Number(r.id);
    const next = choosePreview(r.imageUrl, r.content, r.url);
    if (!next || next === r.imageUrl) continue;
    changed++;
    const sameFile = fileOf(next) !== "" && fileOf(next) === fileOf(r.imageUrl);
    if (sameFile) upsized++; else swapped++;
    hosts.set(hostOf(r.imageUrl), (hosts.get(hostOf(r.imageUrl)) ?? 0) + 1);
    if (!dry) await db.execute(sql`update items set image_url = ${next} where id = ${r.id}`);
  }
  if (seen % 20000 < BATCH) console.log(`  ${seen} looked at, ${changed} changed`);
}
console.log(`${dry ? "dry run: " : ""}${seen} posts with a picture; ${changed} changed (${upsized} asked for the large version of the same file, ${swapped} swapped for the body's first image)`);
console.log("by host:", [...hosts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([h, n]) => `${h} ${n}`).join(", "));
await pool.end();
