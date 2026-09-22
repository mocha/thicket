/**
 * Clear the stray summaries that are nothing but a link's own words. Hacker
 * News hands each post a description that is a single link reading "Comments"
 * pointing at the thread, so every stored HN post ended up with the word
 * "Comments" as its summary; "Read more" and a bare "Permalink" have the same
 * shape. feeds/parse.ts now treats a link-only description as no summary, and
 * this brings the already-stored posts in line. No network. Run alone with
 * `pnpm fix-summaries [--dry]`; in production, `node dist/scripts/fix-summaries.js`.
 *
 * A post is only touched when the body we kept (`content`, the raw publisher
 * HTML) is entirely link text AND the stored summary is exactly that text. The
 * second half is a guard: a feed whose description is a bare link but which
 * also carried a real media description keeps that description untouched.
 */
import { sql } from "drizzle-orm";
import { db, pool } from "../db/client.js";
import { isLinkOnly, stripHtml } from "../feeds/parse.js";

const dry = process.argv.includes("--dry");
const BATCH = 2000;

let after = 0, seen = 0, cleared = 0;
const samples: string[] = [];

for (;;) {
  // Only posts whose content actually holds a link are worth inspecting; the
  // real link-only test runs in JS, matching the parser exactly.
  const rows = (await db.execute<{ id: number; summary: string; content: string }>(sql`
    select id, summary, content from items
    where id > ${after} and summary is not null and content is not null and content ~* '<a[ >]'
    order by id limit ${BATCH}`)).rows;
  if (!rows.length) break;
  for (const r of rows) {
    seen++;
    after = Number(r.id);
    if (!isLinkOnly(r.content)) continue;
    if (stripHtml(r.content) !== r.summary) continue;
    cleared++;
    if (samples.length < 5) samples.push(`#${r.id}: “${r.summary}” → (none)`);
    if (!dry) await db.execute(sql`update items set summary = null where id = ${r.id}`);
  }
  console.log(`  ${seen} looked at, ${cleared} cleared`);
}

console.log(`${dry ? "dry run: " : ""}${cleared} summaries cleared`);
for (const s of samples) console.log(`  ${s}`);
await pool.end();
