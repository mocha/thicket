/**
 * One-off: put back the item bodies we truncated on the way in.
 *
 *   pnpm recover-bodies [--limit N] [--concurrency N] [--dry]
 *
 * Until 2026-09-13 the parser stored a feed item's rich body (`content:encoded`,
 * Atom `<content>`, `content_html`) in `items.content` and put everything else —
 * the plain `<description>` that 46% of the index arrives with — only into
 * `items.summary`, truncated to 280 characters. The rest was discarded at parse
 * time. `parse.ts` now keeps both whole, which fixes every item from here on.
 *
 * This fixes what it can of the past. It re-fetches each feed and fills in
 * `content` for items that have none, matching on the dedupe key so nothing is
 * guessed at. **It can only reach what the feed still lists** — most feeds
 * expose their newest 10-25 entries, so anything that scrolled out of the window
 * stays truncated, permanently. That is the reason this ran the same day the
 * parser was fixed rather than later.
 *
 * Nothing is inserted, nothing is overwritten: this only ever moves a row from
 * "no body" to "a body", so it is safe to re-run and safe to stop halfway.
 */
import { eq, sql } from "drizzle-orm";
import { db, pool, schema } from "../db/client.js";
import { httpGet } from "../feeds/http.js";
import { parseFeedDocument } from "../feeds/parse.js";

const args = process.argv.slice(2);
const opt = (name: string, fallback: number) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : fallback;
};
const dry = args.includes("--dry");
const limit = opt("limit", Infinity);
const concurrency = opt("concurrency", 6);
/** One request at a time per host, however wide the run is. */
const PER_HOST = 1;

const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };

// Only feeds that actually have something to recover, biggest gap first, so a
// run that gets interrupted has still done the most good.
const targets = (await db.execute<{ id: number; url: string; gaps: number }>(sql`
  select f.id, f.url, count(*)::int as gaps
  from feeds f join items i on i.feed_id = f.id
  where i.content is null or i.content = ''
  group by f.id, f.url
  order by gaps desc
`)).rows.slice(0, limit === Infinity ? undefined : limit);

const totalGaps = targets.reduce((n, t) => n + Number(t.gaps), 0);
console.log(`${targets.length} feeds hold ${totalGaps.toLocaleString()} items with no body`);
if (dry || targets.length === 0) {
  console.log(dry ? "dry run, stopping here" : "nothing to do");
  await pool.end();
  process.exit(0);
}

const stats = { feeds: 0, filled: 0, unreachable: 0, outOfWindow: 0 };
let cursor = 0;
let done = 0;

async function recover(feed: { id: number; url: string; gaps: number }) {
  const res = await httpGet(feed.url);
  if (res.status !== 200 || !res.body) { stats.unreachable++; return; }
  const parsed = parseFeedDocument(res.body, feed.url);
  // The dedupe key is how a parsed item and a stored row are the same item, so
  // matching on it means we never attach one post's body to another's row.
  const withBody = parsed.items.filter((it) => it.content && it.content.trim());
  if (withBody.length === 0) return;
  let filled = 0;
  for (const it of withBody) {
    const r = await db
      .update(schema.items)
      .set({ content: it.content })
      .where(sql`${schema.items.feedId} = ${feed.id} and ${schema.items.dedupeKey} = ${it.dedupeKey}
                 and (${schema.items.content} is null or ${schema.items.content} = '')`)
      .returning({ id: schema.items.id });
    filled += r.length;
  }
  stats.filled += filled;
  stats.outOfWindow += Math.max(0, Number(feed.gaps) - filled);
  if (filled) stats.feeds++;
}

await new Promise<void>((resolve) => {
  let inFlight = 0;
  const busyHost = new Map<string, number>();
  const pump = () => {
    while (cursor < targets.length) {
      const t = targets[cursor];
      const h = hostOf(t.url);
      if ((busyHost.get(h) ?? 0) >= PER_HOST) break;
      if (inFlight >= concurrency) break;
      cursor++;
      inFlight++;
      busyHost.set(h, (busyHost.get(h) ?? 0) + 1);
      void recover(t)
        .catch(() => { stats.unreachable++; })
        .finally(() => {
          inFlight--;
          busyHost.set(h, (busyHost.get(h) ?? 1) - 1);
          done++;
          if (done % 100 === 0) console.log(`  ${done}/${targets.length} — ${stats.filled.toLocaleString()} bodies recovered`);
          if (done === targets.length) resolve();
          else pump();
        });
    }
  };
  pump();
});

console.log(`\n${stats.filled.toLocaleString()} bodies recovered across ${stats.feeds} feeds`);
console.log(`${stats.outOfWindow.toLocaleString()} items were past the end of their feed's window and cannot be recovered`);
console.log(`${stats.unreachable} feeds did not answer`);
const [{ have, all }] = (await db.execute<{ have: number; all: number }>(sql`
  select count(*) filter (where content is not null and content <> '')::int as have, count(*)::int as all from items
`)).rows;
console.log(`items with a body: ${have.toLocaleString()} of ${all.toLocaleString()} (${Math.round((have / all) * 100)}%)`);
await pool.end();
