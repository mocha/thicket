/**
 * Seed the feed index from a file of feed URLs, one per line (# starts a
 * comment). This is how an instance gets something to browse on day one.
 *
 *   pnpm ingest <file> [--limit N] [--concurrency N] [--max-age-days N] [--dry]
 *
 * Every URL is normalized, inserted, and then refreshed through the ordinary
 * refresh path — the same code the scheduler runs — so a seeded feed is
 * indistinguishable from one a person added, icon and items included. A URL
 * that does not answer, does not parse, or carries no items is removed again:
 * the index is a browsing surface, and a row with no title is worse than no
 * row. So is a feed whose last post was in 2020 — anything silent for longer
 * than --max-age-days is dropped, which is the difference between a slow blog
 * and an abandoned one. Feeds that already exist are left as they are.
 *
 * New rows are parked six hours out before they are refreshed here, so a
 * scheduler running elsewhere against the same database does not race this
 * script for them. Their real cadence is set by the refresh that follows.
 */
import { readFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { db, pool, schema } from "../db/client.js";
import { normalizeFeedUrl } from "../feeds/normalize.js";
import { refreshFeed } from "../feeds/refresh.js";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const opt = (name: string, fallback: number) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : fallback;
};
const dry = args.includes("--dry");
const limit = opt("limit", Infinity);
/** Silent for longer than this and it is not a feed any more, it is an archive. */
const maxAgeDays = opt("max-age-days", 730);
const concurrency = opt("concurrency", 8);
/** One request at a time per host, however wide the run is. */
const PER_HOST = 1;
const PARK_MS = 6 * 60 * 60 * 1000;

if (!file) {
  console.error("usage: pnpm ingest <file of feed urls> [--limit N] [--concurrency N] [--dry]");
  process.exit(1);
}

const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };

const urls: string[] = [];
const seen = new Set<string>();
for (const raw of readFileSync(file, "utf8").split("\n")) {
  const line = raw.trim();
  // A "#" starts a comment, at the start of a line or after the URL: Kagi's lists put the channel name after each address.
  if (!line || line.startsWith("#")) continue;
  const bare = line.replace(/\s+#.*$/, "");
  let url: string;
  try { url = normalizeFeedUrl(bare); } catch { continue; }
  if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
  seen.add(url);
  urls.push(url);
  if (urls.length >= limit) break;
}

const known = new Set(
  (await db.execute<{ url: string }>(sql`select url from feeds`)).rows.map((r) => r.url),
);
const fresh = urls.filter((u) => !known.has(u));
console.log(`${urls.length} urls in ${file}; ${urls.length - fresh.length} already in the index; ${fresh.length} to try`);
if (dry || fresh.length === 0) {
  console.log(dry ? "dry run, stopping here" : "nothing to do");
  await pool.end();
  process.exit(0);
}

const stats = { added: 0, empty: 0, failed: 0 };
const failures = new Map<string, number>();
const busyHost = new Map<string, number>();
let cursor = 0;
let done = 0;

async function ingest(url: string) {
  const [row] = await db
    .insert(schema.feeds)
    .values({ url, nextFetchAt: new Date(Date.now() + PARK_MS) })
    .onConflictDoNothing()
    .returning();
  if (!row) return; // someone else added it between the check and now
  const r = await refreshFeed(row.id).catch((e) => ({ error: String(e), itemsNew: 0 }));
  const [after] = await db.select().from(schema.feeds).where(eq(schema.feeds.id, row.id));
  const ageDays = after?.lastItemAt ? (Date.now() - after.lastItemAt.getTime()) / 86_400_000 : null;
  const reason = r.error ? shorten(r.error)
    : !after?.title ? "no title"
    : r.itemsNew === 0 ? "no items"
    : ageDays === null ? "no dates"
    : ageDays > maxAgeDays ? `silent ${Math.max(1, Math.round(ageDays / 365))}y`
    : null;
  if (reason) {
    await db.delete(schema.feeds).where(eq(schema.feeds.id, row.id));
    if (reason.startsWith("no ") || reason.startsWith("silent")) stats.empty++;
    else stats.failed++;
    failures.set(reason, (failures.get(reason) ?? 0) + 1);
    return;
  }
  stats.added++;
}

/** Shorten an error to the shape of the problem, so the summary groups. */
function shorten(e: string): string {
  const http = /^HTTP (\d+)/.exec(e);
  if (http) return `HTTP ${http[1]}`;
  if (/timeout|aborted|TimeoutError/i.test(e)) return "timed out";
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(e)) return "no such host";
  if (/certificate|TLS|SSL/i.test(e)) return "bad certificate";
  if (/ECONNREFUSED|ECONNRESET|socket|network|fetch failed/i.test(e)) return "unreachable";
  return e.slice(0, 40);
}

await new Promise<void>((resolve) => {
  const pump = () => {
    while (cursor < fresh.length) {
      const url = fresh[cursor];
      const h = hostOf(url);
      if ((busyHost.get(h) ?? 0) >= PER_HOST) break; // the list is host-sorted rarely; just wait
      if (inFlight >= concurrency) break;
      cursor++;
      inFlight++;
      busyHost.set(h, (busyHost.get(h) ?? 0) + 1);
      void ingest(url)
        .catch((e) => { stats.failed++; failures.set(shorten(String(e)), (failures.get(shorten(String(e))) ?? 0) + 1); })
        .finally(() => {
          inFlight--;
          busyHost.set(h, (busyHost.get(h) ?? 1) - 1);
          done++;
          if (done % 50 === 0) console.log(`  ${done}/${fresh.length} — ${stats.added} added, ${stats.empty} empty, ${stats.failed} failed`);
          if (done === fresh.length) resolve();
          else pump();
        });
    }
  };
  let inFlight = 0;
  pump();
});

console.log(`\n${stats.added} added, ${stats.empty} empty or abandoned, ${stats.failed} failed`);
const why = [...failures.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
if (why.length) console.log("why not:", why.map(([k, n]) => `${k} ${n}`).join(", "));
const [{ n }] = (await db.execute<{ n: number }>(sql`select count(*)::int as n from feeds`)).rows;
console.log(`index now holds ${n} feeds`);
await pool.end();
