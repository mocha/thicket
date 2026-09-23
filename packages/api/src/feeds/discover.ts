/**
 * Given any URL, find the feed(s) behind it. This is the single acquisition
 * path: the add-feed form, the PWA share target, and any future extension or
 * external tool all land here.
 */
import { httpGet, MAX_BYTES, TooLargeError, type HttpResult } from "./http.js";
import { normalizeFeedUrl } from "./normalize.js";
import { parseFeedDocument, type ParsedFeed } from "./parse.js";
import { resolveYouTube } from "./youtube.js";
import { resolveReddit } from "./reddit.js";

/** `note` replaces the raw address in the chooser when the address itself would mean nothing to a reader. */
export type Candidate = { url: string; title: string | null; kind: string | null; note?: string | null };

export type Discovery =
  | { status: "feed"; url: string; parsed: ParsedFeed; etag: string | null; lastModified: string | null }
  | { status: "candidates"; pageUrl: string; candidates: Candidate[] }
  | { status: "none"; pageUrl: string };

const FEED_TYPES = /application\/(rss|atom|feed)\+(xml|json)|application\/(rss|atom)|text\/xml|application\/xml|application\/json/i;
/** What the person adding a feed sees, and what the log records, when the feed itself is over our limit. Keeps "too large" for the importer's match. */
const TOO_LARGE = `This feed is too large for Thicket to read (over ${MAX_BYTES / 1024 / 1024} MB).`;

/** A feed, going by its declared type or its opening tag, as opposed to a web page. */
function looksLikeFeed(res: HttpResult): boolean {
  const type = res.headers.get("content-type") ?? "";
  if (/xml|rss|atom|json/i.test(type) && !/html/i.test(type)) return true;
  return /^\s*(<\?[^>]*>\s*|<!--[\s\S]*?-->\s*)*<(rss|feed|rdf:RDF)\b/i.test(res.body.slice(0, 4096));
}

async function fetchFeed(url: string): Promise<HttpResult> {
  try {
    return await httpGet(url);
  } catch (err) {
    throw err instanceof TooLargeError ? new Error(TOO_LARGE, { cause: err }) : err;
  }
}

const PROBE_PATHS = ["/feed", "/rss", "/feed.xml", "/rss.xml", "/atom.xml", "/index.xml", "/feed.json", "/feed/", "/rss/", "/blog/feed", "/blog/rss.xml", "/blog/index.xml", "/posts/index.xml"];

function tryParse(body: string, url: string): ParsedFeed | null {
  try {
    return parseFeedDocument(body, url);
  } catch {
    return null;
  }
}

/** Pull <link rel="alternate" type="application/rss+xml" href=...> out of an HTML page without a DOM. */
export function extractFeedLinks(html: string, baseUrl: string): Candidate[] {
  const out: Candidate[] = [];
  const seen = new Set<string>();
  const head = html.slice(0, 200_000);
  for (const tag of head.match(/<link\b[^>]*>/gi) ?? []) {
    const attr = (name: string) => new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(tag)?.[1];
    const rel = attr("rel")?.toLowerCase() ?? "";
    const type = attr("type") ?? "";
    const href = attr("href");
    // oEmbed links are also rel="alternate" and their type contains "application/json"
    // or "text/xml", so they slip past FEED_TYPES; exclude them explicitly.
    if (!href || !rel.split(/\s+/).includes("alternate") || !FEED_TYPES.test(type) || /\+oembed/i.test(type)) continue;
    try {
      const abs = normalizeFeedUrl(new URL(href, baseUrl).toString());
      if (seen.has(abs)) continue;
      seen.add(abs);
      out.push({ url: abs, title: attr("title") ?? null, kind: /json/i.test(type) ? "json" : /atom/i.test(type) ? "atom" : "rss" });
    } catch {
      /* skip malformed href */
    }
  }
  return out;
}

export async function discover(input: string): Promise<Discovery> {
  // 0. Sites with a known feed shape that never advertise it (feeds/youtube.ts, feeds/reddit.ts).
  //    Each either names the one feed, or offers a short list for the sheet's chooser.
  const known = (await resolveYouTube(input)) ?? resolveReddit(input);
  if (known && "candidates" in known) return { status: "candidates", pageUrl: known.pageUrl, candidates: known.candidates };
  if (known) {
    const site = /reddit\.com/i.test(known.feedUrl) ? "Reddit" : "YouTube";
    const res = await httpGet(known.feedUrl);
    if (res.status === 429) throw new Error(`${site} is rate-limiting us right now; try again in a minute.`);
    if (res.status >= 400) throw new Error(`${site}'s feed answered HTTP ${res.status}`);
    const parsed = tryParse(res.body, res.finalUrl);
    if (!parsed) throw new Error(`${site} returned something that isn't a feed.`);
    return { status: "feed", url: normalizeFeedUrl(res.finalUrl), parsed, etag: res.headers.get("etag"), lastModified: res.headers.get("last-modified") };
  }

  const url = normalizeFeedUrl(input);
  // A page can be enormous even though its feed links live in the first few
  // kilobytes. Keep the beginning instead of rejecting the whole page at the
  // shared download limit; direct feeds larger than that were already too big
  // to parse, while HTML discovery only inspects the first 200 KB below.
  const res = await httpGet(url, {}, { truncate: true });
  if (res.status >= 400) throw new Error(`HTTP ${res.status} fetching ${url}`);

  // 1. Is it a feed already?
  const direct = tryParse(res.body, res.finalUrl);
  if (direct) {
    return { status: "feed", url: normalizeFeedUrl(res.finalUrl), parsed: direct, etag: res.headers.get("etag"), lastModified: res.headers.get("last-modified") };
  }
  // Cut short and not a page: it's a feed we couldn't read whole. Say so,
  // rather than searching it for links and reporting that nothing was found.
  if (res.truncated && looksLikeFeed(res)) throw new Error(TOO_LARGE);

  // 2. It's a page: look for advertised feeds.
  const advertised = extractFeedLinks(res.body, res.finalUrl);
  if (advertised.length === 1) {
    const one = await fetchFeed(advertised[0].url);
    const parsed = tryParse(one.body, one.finalUrl);
    if (parsed) return { status: "feed", url: normalizeFeedUrl(one.finalUrl), parsed, etag: one.headers.get("etag"), lastModified: one.headers.get("last-modified") };
  }
  if (advertised.length > 1) return { status: "candidates", pageUrl: res.finalUrl, candidates: advertised };

  // 3. Nothing advertised: probe the usual suspects, quietly.
  const origin = new URL(res.finalUrl).origin;
  let tooLarge: Error | null = null;
  for (const path of PROBE_PATHS) {
    try {
      const probe = await fetchFeed(origin + path);
      if (probe.status >= 400) continue;
      const parsed = tryParse(probe.body, probe.finalUrl);
      if (parsed) return { status: "feed", url: normalizeFeedUrl(probe.finalUrl), parsed, etag: probe.headers.get("etag"), lastModified: probe.headers.get("last-modified") };
    } catch (err) {
      // Keep probing, but remember a feed that exists and is only too big:
      // that, not "no feed found", is the honest answer if nothing else works.
      if (err instanceof Error && err.message === TOO_LARGE) tooLarge ??= err;
    }
  }
  if (tooLarge) throw tooLarge;
  return { status: "none", pageUrl: res.finalUrl };
}
