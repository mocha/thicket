/**
 * Survey a corpus of feed URLs without loading them into the app: fetch each
 * once, parse it, and write per-feed statistics (liveness, cadence, article
 * length) to a SQLite file. `pnpm survey:stats` summarizes that file.
 *
 *   pnpm survey <file> [--limit N] [--offset N] [--concurrency N] [--db path]
 *
 * The file has one URL per line; "#" starts a comment, at the start of a line
 * or after the URL. URLs are normalized like the app's, deduplicated, then
 * --offset skips the first N and --limit caps how many are attempted.
 *
 * Resumable: a URL already in the SQLite table is skipped, so a run can be
 * stopped and started again. Feeds whose host was cooling down when their turn
 * came are left out of the table so a later run picks them up.
 *
 * Politeness. Every request goes through feeds/http.ts and feeds/hosts.ts, the
 * same code the app uses: per-host spacing, Retry-After, 429 cooldowns, host
 * outage detection, 20s timeout, 5 MB cap. hosts.ts records its pauses in
 * Postgres, and this script must not touch Postgres at all, so before loading
 * anything it registers a module hook that resolves `db/client.js` to an
 * in-memory stub whose `execute` returns no rows. Pauses still work — they live
 * in memory in hosts.ts — they are just not written down. On top of that, this
 * script never has more than one request in flight per host, like
 * scripts/ingest.ts.
 */
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as sleep } from "node:timers/promises";

// --- keep Postgres out of the picture -------------------------------------------------------------
delete process.env.DATABASE_URL;
const stub = "data:text/javascript," + encodeURIComponent(
  "export const db = { execute: async () => ({ rows: [], rowCount: 0 }) }; export const pool = { end: async () => {} }; export const schema = {};",
);
register("data:text/javascript," + encodeURIComponent(`
  const STUB = ${JSON.stringify(stub)};
  export async function resolve(specifier, context, next) {
    if (/\\/db\\/client(\\.js|\\.ts)?$/.test(specifier)) return { url: STUB, shortCircuit: true };
    return next(specifier, context);
  }`));
// Dynamic imports so the hook above is in place first.
const { httpGet } = await import("../feeds/http.js");
const { hostKey, HostCoolingDown, feedOutcome } = await import("../feeds/hosts.js");
const { normalizeFeedUrl } = await import("../feeds/normalize.js");
const { parseFeedDocument, stripHtml } = await import("../feeds/parse.js");

// --- arguments ------------------------------------------------------------------------------------
const args = process.argv.slice(2);
const VALUE_FLAGS = new Set(["--limit", "--offset", "--concurrency", "--db"]);
const file = args.find((a, i) => !a.startsWith("--") && !VALUE_FLAGS.has(args[i - 1] ?? ""));
const opt = (name: string, fallback: number) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : fallback;
};
const optStr = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const limit = opt("limit", Infinity);
const offset = opt("offset", 0);
const concurrency = opt("concurrency", 12);
const dbPath = resolvePath(optStr("db", "../../.scratch/corpora/survey.sqlite"));
const PROGRESS_EVERY = 250;
/** A host paused for longer than this is not waited for; its feeds are left for a later run. */
const MAX_COOLDOWN_WAIT_MS = 20 * 60_000;
const MAX_COOLDOWN_RETRIES = 3;

if (!file) {
  console.error("usage: pnpm survey <file of feed urls> [--limit N] [--offset N] [--concurrency N] [--db path]");
  process.exit(1);
}

// --- the list -------------------------------------------------------------------------------------
const all: string[] = [];
const seen = new Set<string>();
for (const raw of readFileSync(file, "utf8").split("\n")) {
  const line = raw.trim();
  if (!line || line.startsWith("#")) continue;
  const bare = line.replace(/\s+#.*$/, "");
  let url: string;
  try { url = normalizeFeedUrl(bare); } catch { continue; }
  if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
  seen.add(url);
  all.push(url);
}
const slice = all.slice(offset, Number.isFinite(limit) ? offset + limit : undefined);

// --- the table ------------------------------------------------------------------------------------
mkdirSync(dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath);
db.exec(`pragma journal_mode = wal;
create table if not exists feeds (
  url text primary key,
  host text not null,
  status integer,            -- HTTP status, null when the request itself failed
  error text,                -- http / timeout / dns / tls / refused / reset / too_large / parse / other:<msg>; null when parsed
  final_url text,            -- where redirects ended up, when not the url itself
  content_type text,
  format text,               -- rss / atom / json / rdf / unknown
  title text,
  site_url text,
  language text,
  item_count integer,
  items_dated integer,
  newest_published text,
  oldest_published text,
  posts_7d integer,
  posts_30d integer,
  posts_365d integer,
  posts_per_month real,      -- dated items over the span they cover (min 7 days); null under 2 dated items
  items_with_body integer,
  median_words real,
  mean_words real,
  share_under_200 real,      -- of items with a body
  share_over_2000 real,
  rich_field integer,        -- document carries content:encoded / atom content / content_html
  has_images integer,
  sample_titles text,        -- json, first two item titles
  bytes integer,
  elapsed_ms integer,
  fetched_at text not null
);
create index if not exists feeds_host on feeds (host);`);

const known = new Set(db.prepare("select url from feeds").all().map((r) => (r as { url: string }).url));
const todo = slice.filter((u) => !known.has(u));
console.log(`${all.length} urls in ${file}; taking ${slice.length} (offset ${offset}); ${slice.length - todo.length} already surveyed; ${todo.length} to fetch at concurrency ${concurrency}`);
if (todo.length === 0) { console.log("nothing to do"); db.close(); process.exit(0); }

const insert = db.prepare(`insert or replace into feeds (
  url, host, status, error, final_url, content_type, format, title, site_url, language,
  item_count, items_dated, newest_published, oldest_published, posts_7d, posts_30d, posts_365d, posts_per_month,
  items_with_body, median_words, mean_words, share_under_200, share_over_2000, rich_field, has_images,
  sample_titles, bytes, elapsed_ms, fetched_at
) values (
  @url, @host, @status, @error, @final_url, @content_type, @format, @title, @site_url, @language,
  @item_count, @items_dated, @newest_published, @oldest_published, @posts_7d, @posts_30d, @posts_365d, @posts_per_month,
  @items_with_body, @median_words, @mean_words, @share_under_200, @share_over_2000, @rich_field, @has_images,
  @sample_titles, @bytes, @elapsed_ms, @fetched_at
)`);

// --- one feed -------------------------------------------------------------------------------------
type Row = Record<string, string | number | null> & { url: string; host: string; status: number | null; error: string | null };

const DAY = 86_400_000;

function blank(url: string): Row {
  return {
    url, host: hostKey(url), status: null, error: null, final_url: null, content_type: null, format: null, title: null, site_url: null, language: null,
    item_count: null, items_dated: null, newest_published: null, oldest_published: null, posts_7d: null, posts_30d: null, posts_365d: null, posts_per_month: null,
    items_with_body: null, median_words: null, mean_words: null, share_under_200: null, share_over_2000: null, rich_field: null, has_images: null,
    sample_titles: null, bytes: null, elapsed_ms: null, fetched_at: new Date().toISOString(),
  };
}

function words(html: string): number {
  const text = stripHtml(html);
  return text ? text.split(/\s+/).length : 0;
}

/** What the document says about its language, cheaply, from the raw text. */
function languageHint(text: string): string | null {
  const head = text.slice(0, 4000);
  const m = /<language>\s*([A-Za-z-]{2,10})\s*<\/language>|xml:lang=["']([A-Za-z-]{2,10})["']|<dc:language>\s*([A-Za-z-]{2,10})\s*<\/dc:language>|"language"\s*:\s*"([A-Za-z-]{2,10})"/.exec(head);
  const v = m?.[1] ?? m?.[2] ?? m?.[3] ?? m?.[4];
  return v ? v.toLowerCase() : null;
}

/** The shape of a failed request, so the summary groups. */
function classify(e: unknown): string {
  const err = e as { name?: string; message?: string; cause?: { code?: string; message?: string } };
  const s = `${err?.name ?? ""} ${err?.message ?? ""} ${err?.cause?.code ?? ""} ${err?.cause?.message ?? ""}`;
  if (/TimeoutError|timeout|aborted/i.test(s)) return "timeout";
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(s)) return "dns";
  if (/CERT|certificate|TLS|SSL|HostnameMismatch|handshake/i.test(s)) return "tls";
  if (/ECONNREFUSED/i.test(s)) return "refused";
  if (/ECONNRESET|EPIPE|socket hang up|other side closed|terminated/i.test(s)) return "reset";
  if (/too large/i.test(s)) return "too_large";
  if (/redirect/i.test(s)) return "redirect";
  if (/Invalid URL|ERR_INVALID_URL|unsupported/i.test(s)) return "bad_url";
  return `other:${String(err?.message ?? e).slice(0, 60)}`;
}

async function survey(url: string): Promise<Row> {
  const started = Date.now();
  const row = blank(url);
  const finish = () => { row.elapsed_ms = Date.now() - started; return row; };

  let res: Awaited<ReturnType<typeof httpGet>>;
  try {
    res = await httpGet(url);
  } catch (e) {
    if (e instanceof HostCoolingDown) throw e;
    row.error = classify(e);
    return finish();
  }
  row.status = res.status;
  row.final_url = res.finalUrl === url ? null : res.finalUrl;
  row.content_type = res.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? null;
  row.bytes = Buffer.byteLength(res.body);
  if (res.status < 200 || res.status >= 300) { row.error = "http"; return finish(); }

  let feed: ReturnType<typeof parseFeedDocument>;
  try {
    feed = parseFeedDocument(res.body, url);
  } catch {
    row.error = "parse";
    row.format = "unknown";
    return finish();
  }
  row.format = feed.kind;
  row.title = feed.title;
  row.site_url = feed.siteUrl;
  row.language = languageHint(res.body);
  row.rich_field = /<content:encoded|<content[\s>]|"content_html"|"content_text"/.test(res.body) ? 1 : 0;

  const now = Date.now();
  const items = feed.items;
  const dates = items.map((i) => i.publishedAt?.getTime()).filter((t): t is number => t !== undefined && Number.isFinite(t));
  row.item_count = items.length;
  row.items_dated = dates.length;
  if (dates.length) {
    const newest = Math.max(...dates);
    const oldest = Math.min(...dates);
    row.newest_published = new Date(newest).toISOString();
    row.oldest_published = new Date(oldest).toISOString();
    row.posts_7d = dates.filter((t) => t >= now - 7 * DAY).length;
    row.posts_30d = dates.filter((t) => t >= now - 30 * DAY).length;
    row.posts_365d = dates.filter((t) => t >= now - 365 * DAY).length;
    if (dates.length >= 2) {
      const spanDays = Math.max(7, (newest - oldest) / DAY);
      row.posts_per_month = Math.round((dates.length / spanDays) * 30.44 * 100) / 100;
    }
  }
  const lengths = items.map((i) => (i.content ? words(i.content) : 0)).filter((n) => n > 0).sort((a, b) => a - b);
  row.items_with_body = lengths.length;
  if (lengths.length) {
    const mid = lengths.length >> 1;
    row.median_words = lengths.length % 2 ? lengths[mid] : (lengths[mid - 1] + lengths[mid]) / 2;
    row.mean_words = Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length);
    row.share_under_200 = Math.round((lengths.filter((n) => n < 200).length / lengths.length) * 1000) / 1000;
    row.share_over_2000 = Math.round((lengths.filter((n) => n > 2000).length / lengths.length) * 1000) / 1000;
  }
  row.has_images = items.some((i) => i.imageUrl) ? 1 : 0;
  row.sample_titles = JSON.stringify(items.slice(0, 2).map((i) => (i.title ?? "").slice(0, 120)));
  return finish();
}

// --- the run: many hosts at once, one request per host ---------------------------------------------
const stats = { ok: 0, error: 0, cooldown: 0 };
const errors = new Map<string, number>();
const t0 = Date.now();
let done = 0;
let inFlight = 0;
let cursor = 0;
const busy = new Set<string>();
/** Waiting for their host: busy with another of our requests, or paused by hosts.ts until `notBefore`. */
const deferred: Array<{ url: string; notBefore: number; retries: number }> = [];
const feedIds = new Map(todo.map((u, i) => [u, i] as const));

function record(row: Row) {
  insert.run(row);
  const err = row.error === "http" ? `http ${row.status}` : row.error;
  if (err) { stats.error++; errors.set(err, (errors.get(err) ?? 0) + 1); } else stats.ok++;
  settled();
}

function settled() {
  done++;
  if (done % PROGRESS_EVERY === 0) progress();
}

const fmt = (s: number) => (s >= 3600 ? `${(s / 3600).toFixed(1)}h` : s >= 60 ? `${(s / 60).toFixed(1)}m` : `${s.toFixed(0)}s`);

function progress(final = false) {
  const elapsed = (Date.now() - t0) / 1000;
  const rate = done / Math.max(1, elapsed);
  const eta = rate > 0 ? (todo.length - done) / rate : 0;
  const top = [...errors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => `${k} ${n}`).join(", ");
  console.log(`${final ? "done: " : "  "}${done}/${todo.length}  ok ${stats.ok}  err ${stats.error}  [${top}]  ${(rate * 60).toFixed(0)}/min  ${final ? `in ${fmt(elapsed)}` : `eta ${fmt(eta)}`}  ${inFlight} in flight, ${deferred.length} waiting`);
}

await new Promise<void>((resolveRun) => {
  let timer: NodeJS.Timeout | null = null;

  const launch = (url: string, retries: number) => {
    const h = hostKey(url);
    busy.add(h);
    inFlight++;
    void survey(url)
      .then((row) => {
        record(row);
        // Same signal the app gives hosts.ts: null for a working fetch, otherwise the failure's shape.
        return feedOutcome(url, feedIds.get(url) ?? 0, row.error ? (row.error === "http" ? `HTTP ${row.status}` : row.error) : null).catch(() => {});
      })
      .catch((e) => {
        if (e instanceof HostCoolingDown) {
          const wait = e.until.getTime() - Date.now();
          if (wait <= MAX_COOLDOWN_WAIT_MS && retries < MAX_COOLDOWN_RETRIES) { deferred.push({ url, notBefore: e.until.getTime(), retries: retries + 1 }); return; }
          stats.cooldown++;
          settled();
          return;
        }
        record({ ...blank(url), error: classify(e) });
      })
      .finally(() => {
        inFlight--;
        busy.delete(h);
        pump();
      });
  };

  const pump = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    const now = Date.now();
    // Deferred first, so a host's backlog drains in order.
    for (let i = 0; i < deferred.length && inFlight < concurrency; ) {
      const d = deferred[i];
      if (d.notBefore <= now && !busy.has(hostKey(d.url))) { deferred.splice(i, 1); launch(d.url, d.retries); } else i++;
    }
    while (inFlight < concurrency && cursor < todo.length) {
      const url = todo[cursor++];
      if (busy.has(hostKey(url))) { deferred.push({ url, notBefore: 0, retries: 0 }); continue; }
      launch(url, 0);
    }
    if (inFlight === 0 && cursor >= todo.length) {
      if (deferred.length === 0) return resolveRun();
      // Everything left is waiting on a pause; wake up when the earliest ends.
      const next = Math.min(...deferred.map((d) => d.notBefore));
      timer = setTimeout(pump, Math.max(250, next - Date.now()));
    }
  };
  pump();
});

progress(true);
if (stats.cooldown) console.log(`${stats.cooldown} feeds skipped because their host was cooling down; run again later to pick them up`);
const total = (db.prepare("select count(*) as n from feeds").get() as { n: number }).n;
console.log(`${dbPath} now holds ${total} feeds`);
db.close();
await sleep(10); // let the last log lines flush
