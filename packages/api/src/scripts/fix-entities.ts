/**
 * Decode the HTML entities sitting in already-stored text. Titles, summaries
 * and author names are plain text, but until feeds/parse.ts knew the whole
 * HTML5 table anything outside a handful of entities was kept verbatim, so
 * the index holds thousands of "&rsquo;" and "&ldquo;" that readers see in
 * cards, headings and addresses. No network. Run alone with
 * `pnpm fix-entities [--dry]`; in production, `node dist/scripts/fix-entities.js`.
 *
 * Decoding is what a fresh parse would now do, and only that: one pass, no
 * tag stripping, so a "<" that was written as "&lt;" by a publisher and
 * decoded long ago is left where it is. Item slugs and the search vector are
 * derived from these columns, so both follow on their own.
 */
import { sql } from "drizzle-orm";
import { decodeHTML } from "entities";
import { db, pool } from "../db/client.js";

const dry = process.argv.includes("--dry");
const BATCH = 2000;
/** Worth a second look only if it holds something shaped like an entity. */
const ENTITY = /&(#[0-9]+|#x[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]{1,30});/;

const fix = (v: string | null): string | null => {
  if (!v || !ENTITY.test(v)) return v;
  const next = decodeHTML(v).replace(/\s+/g, " ").trim();
  return next === v ? v : next;
};

let after = 0, seen = 0, items = 0, titles = 0, summaries = 0, authors = 0;
const samples: string[] = [];

for (;;) {
  const rows = (await db.execute<{ id: number; title: string | null; summary: string | null; author: string | null }>(sql`
    select id, title, summary, author from items
    where id > ${after} and (title ~ '&[a-zA-Z#][a-zA-Z0-9]*;' or summary ~ '&[a-zA-Z#][a-zA-Z0-9]*;' or author ~ '&[a-zA-Z#][a-zA-Z0-9]*;')
    order by id limit ${BATCH}`)).rows;
  if (!rows.length) break;
  for (const r of rows) {
    seen++;
    after = Number(r.id);
    const title = fix(r.title), summary = fix(r.summary), author = fix(r.author);
    const changed = [title !== r.title, summary !== r.summary, author !== r.author];
    if (!changed.some(Boolean)) continue;
    items++;
    if (changed[0]) titles++;
    if (changed[1]) summaries++;
    if (changed[2]) authors++;
    if (changed[0] && samples.length < 5 && r.title) samples.push(`${r.title}  →  ${title}`);
    if (!dry) await db.execute(sql`update items set title = ${title}, summary = ${summary}, author = ${author} where id = ${r.id}`);
  }
  console.log(`  ${seen} looked at, ${items} changed`);
}

let feeds = 0;
const frows = (await db.execute<{ id: number; title: string | null; description: string | null }>(sql`
  select id, title, description from feeds
  where title ~ '&[a-zA-Z#][a-zA-Z0-9]*;' or description ~ '&[a-zA-Z#][a-zA-Z0-9]*;' order by id`)).rows;
for (const f of frows) {
  const title = fix(f.title), description = fix(f.description);
  if (title === f.title && description === f.description) continue;
  feeds++;
  if (!dry) await db.execute(sql`update feeds set title = ${title}, description = ${description} where id = ${f.id}`);
}

console.log(`${dry ? "dry run: " : ""}${items} posts rewritten (${titles} titles, ${summaries} summaries, ${authors} authors) and ${feeds} feeds`);
for (const s of samples) console.log(`  ${s}`);
await pool.end();
