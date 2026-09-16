/**
 * Summarise a survey.sqlite written by scripts/survey.ts: synoptic tables only,
 * no per-feed rows.
 *
 *   pnpm survey:stats [--db path]
 */
import { resolve as resolvePath } from "node:path";
import { DatabaseSync } from "node:sqlite";

const args = process.argv.slice(2);
const i = args.indexOf("--db");
const dbPath = resolvePath(i >= 0 && args[i + 1] ? args[i + 1] : "../../.scratch/corpora/survey.sqlite");
const db = new DatabaseSync(dbPath, { readOnly: true });

type Rows = Array<Record<string, string | number | null>>;
const q = (sql: string): Rows => db.prepare(sql).all() as Rows;
const one = (sql: string): number => Number(Object.values(db.prepare(sql).get() as Record<string, number>)[0] ?? 0);

const total = one("select count(*) from feeds");
const parsed = one("select count(*) from feeds where error is null");
const pct = (n: number, of = total) => (of ? `${((100 * n) / of).toFixed(1)}%` : "-");
const heading = (t: string) => console.log(`\n${t}\n${"-".repeat(t.length)}`);
const table = (rows: Array<[string, number]>, of = total) => {
  const w = Math.max(...rows.map(([k]) => k.length), 4);
  for (const [k, n] of rows) console.log(`  ${k.padEnd(w)}  ${String(n).padStart(6)}  ${pct(n, of).padStart(6)}`);
};

const now = Date.now();
const iso = (daysAgo: number) => new Date(now - daysAgo * 86_400_000).toISOString();

console.log(`survey of ${total} feeds in ${dbPath}`);
console.log(`fetched ${q("select min(fetched_at) a, max(fetched_at) b from feeds").map((r) => `${r.a} .. ${r.b}`)[0]}`);

heading("outcome");
table([
  ["parsed ok", parsed],
  ["http 200, unparseable", one("select count(*) from feeds where error = 'parse'")],
  ["http 401/403", one("select count(*) from feeds where error = 'http' and status in (401, 403)")],
  ["http 404/410", one("select count(*) from feeds where error = 'http' and status in (404, 410)")],
  ["http 429", one("select count(*) from feeds where error = 'http' and status = 429")],
  ["http other 4xx", one("select count(*) from feeds where error = 'http' and status between 400 and 499 and status not in (401, 403, 404, 410, 429)")],
  ["http 5xx", one("select count(*) from feeds where error = 'http' and status between 500 and 599")],
  ["timeout", one("select count(*) from feeds where error = 'timeout'")],
  ["dns", one("select count(*) from feeds where error = 'dns'")],
  ["tls", one("select count(*) from feeds where error = 'tls'")],
  ["refused / reset", one("select count(*) from feeds where error in ('refused', 'reset')")],
  ["too large", one("select count(*) from feeds where error = 'too_large'")],
  ["other", one("select count(*) from feeds where error is not null and error not in ('parse', 'http', 'timeout', 'dns', 'tls', 'refused', 'reset', 'too_large')")],
]);
const others = q("select error, count(*) n from feeds where error like 'other:%' group by error order by n desc limit 4");
if (others.length) console.log(`  other, most common: ${others.map((r) => `${String(r.error).slice(6)} (${r.n})`).join("; ")}`);

heading(`liveness (of ${parsed} parsed)`);
table([
  ["posted in last 7d", one(`select count(*) from feeds where error is null and newest_published >= '${iso(7)}'`)],
  ["posted in last 30d", one(`select count(*) from feeds where error is null and newest_published >= '${iso(30)}'`)],
  ["posted in last 365d", one(`select count(*) from feeds where error is null and newest_published >= '${iso(365)}'`)],
  ["silent 1-2y", one(`select count(*) from feeds where error is null and newest_published < '${iso(365)}' and newest_published >= '${iso(730)}'`)],
  ["silent >2y", one(`select count(*) from feeds where error is null and newest_published < '${iso(730)}'`)],
  ["items but never dated", one("select count(*) from feeds where error is null and item_count > 0 and newest_published is null")],
  ["no items at all", one("select count(*) from feeds where error is null and item_count = 0")],
], parsed);

heading("posts per month (dated items over the span they cover)");
table([
  ["0 / undatable", one("select count(*) from feeds where error is null and (posts_per_month is null or posts_per_month = 0)")],
  ["<1", one("select count(*) from feeds where error is null and posts_per_month > 0 and posts_per_month < 1")],
  ["1-4", one("select count(*) from feeds where error is null and posts_per_month >= 1 and posts_per_month < 4")],
  ["4-15", one("select count(*) from feeds where error is null and posts_per_month >= 4 and posts_per_month < 15")],
  ["15-60", one("select count(*) from feeds where error is null and posts_per_month >= 15 and posts_per_month < 60")],
  ["60+", one("select count(*) from feeds where error is null and posts_per_month >= 60")],
], parsed);

heading("median article length (words, per feed)");
table([
  ["no body", one("select count(*) from feeds where error is null and (items_with_body is null or items_with_body = 0)")],
  ["<200", one("select count(*) from feeds where error is null and items_with_body > 0 and median_words < 200")],
  ["200-800", one("select count(*) from feeds where error is null and median_words >= 200 and median_words < 800")],
  ["800-2000", one("select count(*) from feeds where error is null and median_words >= 800 and median_words < 2000")],
  ["2000+", one("select count(*) from feeds where error is null and median_words >= 2000")],
], parsed);

heading("bodies");
table([
  ["full-content field (content:encoded / atom content / content_html)", one("select count(*) from feeds where error is null and rich_field = 1")],
  ["summary/description only", one("select count(*) from feeds where error is null and rich_field = 0 and items_with_body > 0")],
  ["no text at all", one("select count(*) from feeds where error is null and rich_field = 0 and (items_with_body is null or items_with_body = 0)")],
  ["any item with an image", one("select count(*) from feeds where error is null and has_images = 1")],
  ["declares a language", one("select count(*) from feeds where error is null and language is not null")],
], parsed);
const langs = q("select language, count(*) n from feeds where error is null and language is not null group by language order by n desc limit 6");
if (langs.length) console.log(`  languages: ${langs.map((r) => `${r.language} ${r.n}`).join(", ")}`);

heading("format");
table(q("select format, count(*) n from feeds where format is not null group by format order by n desc").map((r) => [String(r.format), Number(r.n)]), parsed);

heading("top hosts");
const hosts = q("select host, count(*) n, sum(error is null) ok from feeds group by host order by n desc limit 12");
for (const r of hosts) console.log(`  ${String(r.host).padEnd(28)} ${String(r.n).padStart(5)}  (${r.ok} parsed)`);

heading("attractive candidates");
const attractive = one(`select count(*) from feeds where error is null and newest_published >= '${iso(30)}' and median_words >= 300 and coalesce(posts_per_month, 0) <= 60`);
console.log(`  active in last 30d, median body >= 300 words, <= 60 posts/month: ${attractive} (${pct(attractive, parsed)} of parsed, ${pct(attractive)} of all)`);
const med = q("select median_words from feeds where error is null and median_words is not null order by median_words").map((r) => Number(r.median_words));
if (med.length) console.log(`  median of per-feed median lengths: ${med[med.length >> 1]} words; mean bytes per fetched feed: ${Math.round(one("select avg(bytes) from feeds where bytes is not null") / 1024)} KB`);

db.close();
