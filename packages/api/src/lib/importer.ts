/**
 * Bringing someone's feeds in from another reader, as a workflow with a look
 * before the leap: read the file, show what is in it, check the feeds, then
 * make the collections the person chose. Three steps, three functions:
 *
 * 1. `readImport`: parse an OPML document into groups, one per folder, and say
 *    what can be told about each feed without fetching it.
 * 2. `checkFeeds`: fetch the ones thicket has never seen, a few at a time, so
 *    the review can say which will work and why the rest won't.
 * 3. `commitImport`: make one new top-level collection per chosen group.
 *
 * **Folders become collections, side by side. Never sub-collections** (decided
 * 2026-09-21): nesting is kept for a later, larger plan. A folder inside a
 * folder becomes its own collection too, named "Outer / Inner". lib/opml.ts is
 * the other importer, the one that copies a thicket collection whole and keeps
 * its shape; this one is for arriving from somewhere else.
 *
 * **An import always makes new collections** (decided 2026-09-22, revising the
 * day before): a group whose name is already one of mine is numbered rather
 * than merged into — "Videos", then "Videos 1", then "Videos 2". Importing the
 * same file twice therefore gives a second set, which is visible and easy to
 * delete, rather than silently folding into what is there.
 *
 * The file is sent twice, once to read and once as the chosen groups, and
 * nothing is stored in between: a review that is abandoned leaves no trace,
 * and in particular no feed rows, which the scheduler would start fetching.
 */
import { eq, inArray } from "drizzle-orm";
import { parseOpml } from "feedsmith";
import { db, schema } from "../db/client.js";
import { httpGet } from "../feeds/http.js";
import { HostCoolingDown } from "../feeds/hosts.js";
import { extractFeedLinks } from "../feeds/discover.js";
import { parseFeedDocument } from "../feeds/parse.js";
import { isHttpUrl, normalizeFeedUrl } from "../feeds/normalize.js";
import { addFeedToCollection, ensureFeedLazy } from "./subscribe.js";
import { slugify, uniqueCollectionSlug } from "./slug.js";

/** More than any real reading list; enough to stop a file being used to make thicket fetch the web. */
export const MAX_IMPORT_FEEDS = 2000;
/** Feeds checked per request. The client walks the list in batches this size and fills the review in as it goes. */
export const CHECK_BATCH = 8;

/**
 * What is known about a feed. `ok`: it works, or thicket already follows it
 * happily. `failed`: it will not work, and `reason` says why in words. `unsure`:
 * it could not be checked just now (the site was busy or briefly broken); it is
 * added anyway and the scheduler keeps trying, because refusing it would lose
 * a feed over a bad minute. `pending`: not checked yet.
 */
export type FeedState = "ok" | "failed" | "unsure" | "pending";
/**
 * A verdict, and whether trying again in a moment could change it. `retry` is
 * for the review page, which has a person waiting and can afford another go:
 * true for the troubles that pass on their own (a timeout, a site briefly
 * 500ing), false when the site told us to wait — a 429, or a host already
 * paused. Asking those again inside a minute is the rudeness the politeness
 * layer exists to prevent, and would only earn the same answer.
 */
type Verdict = { state: FeedState; reason: string; retry: boolean };
/** `following`: already in one of my collections, so importing it changes nothing but where it is filed. */
export type ImportFeed = { url: string; title: string | null; siteUrl: string | null; state: FeedState; reason: string | null; following: boolean; retry: boolean };
export type ImportGroup = {
  name: string;
  feeds: ImportFeed[];
  /** A collection of mine already holding this name, so the new one will be numbered beside it. */
  existing: { id: number; name: string; slug: string } | null;
};
export type ImportPreview = { title: string | null; source: string | null; groups: ImportGroup[]; emptyFolders: string[]; duplicates: number };

type Outline = { text?: string; title?: string; xmlUrl?: string; htmlUrl?: string; category?: string; outlines?: Outline[] };

export class ImportError extends Error {}

/** Where a file came from, when it says. Only used to word the page ("from Feedly"). */
function sourceOf(title: string | null): string | null {
  if (!title) return null;
  if (/in feedly cloud/i.test(title)) return "Feedly";
  if (/inoreader/i.test(title)) return "Inoreader";
  if (/newsblur/i.test(title)) return "NewsBlur";
  if (/freshrss/i.test(title)) return "FreshRSS";
  if (/miniflux/i.test(title)) return "Miniflux";
  if (/feedbin/i.test(title)) return "Feedbin";
  return null;
}

/**
 * Feeds that can be known not to work from their address alone, with the
 * sentence that says why. Each of these was seen in a real export or measured
 * (see the notes repo, backlog/project-importer).
 */
function knownDead(url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return "This isn’t a web address."; }
  // NewsBlur's newsletter:, webfeed: and the like: addresses only the reader that wrote them can open.
  if (u.protocol !== "http:" && u.protocol !== "https:") return "This is an address only your old reader understands, not a feed.";
  const host = u.hostname.toLowerCase();
  if (host === "feedly.com" || host.endsWith(".feedly.com")) return "This feed was made inside Feedly and only works there.";
  if (host === "gdata.youtube.com") return "YouTube retired this kind of feed address years ago.";
  if (/(^|\.)youtube\.com$/.test(host) && u.searchParams.has("playlist_id")) return "YouTube no longer publishes feeds for playlists.";
  // X itself, not its company blogs (blog.x.com and blog.twitter.com publish real feeds).
  if (/^((www|mobile)\.)?(twitter|x)\.com$/.test(host)) return "X no longer offers feeds.";
  return null;
}

/** The sentence for a status code, for someone who has never seen one. */
function reasonForStatus(status: number): Verdict {
  if (status === 404 || status === 410) return { state: "failed", reason: `The site says this feed no longer exists (${status}).`, retry: false };
  if (status === 401 || status === 403) return { state: "failed", reason: `The site doesn’t let feed readers in (${status}).`, retry: false };
  // Asked to slow down: the host is paused now, so another go would be refused before it left the building.
  if (status === 429) return { state: "unsure", reason: "The site asked us to slow down. It’s added anyway and will be tried again.", retry: false };
  if (status >= 500) return { state: "unsure", reason: `The site is having trouble right now (${status}). It’s added anyway and will be tried again.`, retry: true };
  return { state: "failed", reason: `The site answered with an error (${status}).`, retry: false };
}

function reasonForError(err: unknown): Verdict {
  if (err instanceof HostCoolingDown) return { state: "unsure", reason: "The site is busy, so this wasn’t checked. It’s added anyway and will be tried again.", retry: false };
  const msg = String((err as { cause?: { code?: string } })?.cause?.code ?? (err instanceof Error ? err.message : err));
  if (/ENOTFOUND|EAI_AGAIN/.test(msg)) return { state: "failed", reason: "That site’s address doesn’t exist any more.", retry: false };
  // The one that is usually us, not them: a slow minute on this connection looks exactly like this.
  if (/timeout|TimeoutError|aborted/i.test(msg)) return { state: "unsure", reason: "The site didn’t answer in time. It’s added anyway and will be tried again.", retry: true };
  if (/too large/.test(msg)) return { state: "failed", reason: "The feed is too large to read.", retry: false };
  if (/CERT|SSL|TLS/i.test(msg)) return { state: "failed", reason: "The site’s security certificate is broken.", retry: false };
  return { state: "failed", reason: "We couldn’t reach the site.", retry: false };
}

/**
 * Read an OPML document into groups. Folders are outlines without an xmlUrl;
 * feeds outside any folder are grouped by their `category` attribute when the
 * file uses that instead of folders (some readers do), and otherwise gathered
 * into one group named after the file.
 */
export async function readImport(userId: number, text: string): Promise<ImportPreview> {
  let doc: ReturnType<typeof parseOpml>;
  try {
    doc = parseOpml(text);
  } catch (err) {
    throw new ImportError(`That file isn’t one we can read (${err instanceof Error ? err.message : err}). Look for an “OPML” export in your old reader.`);
  }
  const title = doc.head?.title?.trim() || null;
  const source = sourceOf(title);
  const byName = new Map<string, Map<string, ImportFeed>>();
  const emptyFolders: string[] = [];
  let seen = 0;
  let duplicates = 0;

  const looseName = source ? `From ${source}` : title && !/subscriptions/i.test(title) ? title : "Imported feeds";
  const add = (group: string, o: Outline) => {
    if (++seen > MAX_IMPORT_FEEDS) throw new ImportError(`That file has more than ${MAX_IMPORT_FEEDS} feeds. Split it into smaller files and bring them in one at a time.`);
    const raw = o.xmlUrl!.trim();
    const dead = knownDead(raw);
    let url = raw;
    if (!dead) { try { url = normalizeFeedUrl(raw); } catch { /* knownDead said it parses; keep it as written */ } }
    const feeds = byName.get(group) ?? new Map<string, ImportFeed>();
    byName.set(group, feeds);
    if (feeds.has(url)) { duplicates++; return; }
    const name = (o.title ?? o.text ?? "").trim() || null;
    feeds.set(url, { url, title: name, siteUrl: o.htmlUrl?.trim() || null, state: dead ? "failed" : "pending", reason: dead, following: false, retry: false });
  };
  const walk = (outlines: Outline[] | undefined, path: string[]) => {
    for (const o of outlines ?? []) {
      if (o.xmlUrl?.trim()) {
        // The first real category: FeedLand files also put every feed in "all", which is no folder at all.
        const cat = path.length ? null : o.category?.split(",").map((c) => c.replace(/^\/+|\/+$/g, "").replace(/\//g, " / ").trim()).find((c) => c && c.toLowerCase() !== "all");
        add(path.length ? path.join(" / ") : cat || looseName, o);
      } else {
        const name = (o.title ?? o.text ?? "").trim() || "Untitled";
        if (!o.outlines?.length) { emptyFolders.push(name); continue; }
        walk(o.outlines, [...path, name]);
      }
    }
  };
  walk(doc.body?.outlines as Outline[] | undefined, []);
  if (seen === 0) throw new ImportError("That file doesn’t list any feeds.");

  // What thicket already knows, so only the feeds it has never seen need fetching.
  const all = [...byName.values()].flatMap((m) => [...m.values()]).filter((f) => f.state === "pending");
  const urls = [...new Set(all.map((f) => f.url))];
  const known = new Map<string, typeof schema.feeds.$inferSelect>();
  for (let i = 0; i < urls.length; i += 500) {
    for (const row of await db.select().from(schema.feeds).where(inArray(schema.feeds.url, urls.slice(i, i + 500)))) known.set(row.url, row);
  }
  const followed = new Set((await db.select({ feedId: schema.collectionFeeds.feedId }).from(schema.collectionFeeds)
    .innerJoin(schema.collections, eq(schema.collections.id, schema.collectionFeeds.collectionId))
    .where(eq(schema.collections.userId, userId))).map((r) => r.feedId));
  for (const f of all) {
    const row = known.get(f.url);
    if (row) f.following = followed.has(row.id);
    if (!row || !row.lastFetchedAt) continue;
    f.title = row.title ?? f.title;
    f.siteUrl = row.siteUrl ?? f.siteUrl;
    // A feed thicket has been failing to fetch for a while is reported as such; one bad fetch is not a verdict.
    if (row.consecutiveFailures >= 3) Object.assign(f, row.lastStatus && row.lastStatus >= 400 ? reasonForStatus(row.lastStatus) : { state: "unsure" as FeedState, reason: "Thicket has had trouble reaching this lately. It’s added anyway and will keep trying.", retry: true });
    else f.state = "ok";
  }

  // Groups whose name is already one of my collections are flagged, so the review can say the new one will be numbered.
  const mine = await db.select({ id: schema.collections.id, name: schema.collections.name, slug: schema.collections.slug })
    .from(schema.collections).where(eq(schema.collections.userId, userId));
  const bySlug = new Map(mine.map((c) => [c.slug, c]));
  const groups: ImportGroup[] = [...byName].map(([name, feeds]) => ({ name, feeds: [...feeds.values()], existing: bySlug.get(slugify(name)) ?? null }));
  return { title, source, groups, emptyFolders, duplicates };
}

/**
 * Check feeds thicket has not seen, by fetching each one once. Politeness is
 * httpGet's job (one request at a time per site); this runs a batch in
 * parallel knowing different sites go at once and the same site takes turns.
 * A page instead of a feed is forgiven if it names exactly one feed, which is
 * what a site that moved its feed usually leaves behind.
 */
export async function checkFeeds(urls: string[]): Promise<{ url: string; state: FeedState; reason: string | null; title: string | null; finalUrl: string | null; retry: boolean }[]> {
  return Promise.all(urls.map(async (url) => {
    const dead = knownDead(url);
    if (dead) return { url, state: "failed" as FeedState, reason: dead, title: null, finalUrl: null, retry: false };
    try {
      let res = await httpGet(url);
      if (res.status >= 400) return { url, ...reasonForStatus(res.status), title: null, finalUrl: null };
      let parsed = tryParse(res.body, res.finalUrl);
      if (!parsed) {
        const links = /<html[\s>]|<!doctype html/i.test(res.body.slice(0, 2000)) ? extractFeedLinks(res.body, res.finalUrl) : [];
        if (links.length !== 1) return { url, state: "failed" as FeedState, reason: links.length ? "This is a web page with several feeds, not a feed. Add the one you want from inside thicket." : "This address is a web page, not a feed.", title: null, finalUrl: null, retry: false };
        res = await httpGet(links[0].url);
        parsed = res.status < 400 ? tryParse(res.body, res.finalUrl) : null;
        if (!parsed) return { url, state: "failed" as FeedState, reason: "This address is a web page, not a feed.", title: null, finalUrl: null, retry: false };
      }
      const finalUrl = normalizeFeedUrl(res.finalUrl);
      return { url, state: "ok" as FeedState, reason: null, title: parsed.title ?? null, finalUrl: finalUrl === url ? null : finalUrl, retry: false };
    } catch (err) {
      return { url, ...reasonForError(err), title: null, finalUrl: null };
    }
  }));
}

function tryParse(body: string, url: string) {
  try { return parseFeedDocument(body, url); } catch { return null; }
}

export type CommitGroup = { name: string; feeds: { url: string; title?: string | null }[] };
export type CommitResult = { collections: { id: number; name: string; slug: string; renamedFrom: string | null; added: number }[] };

/**
 * The name this group's collection gets: the one asked for, or it with a number
 * after it when that name is taken — "Videos", "Videos 1", "Videos 2". `taken`
 * is every slug of mine, and grows as the import goes, so two groups in one
 * file that want the same name do not collide with each other either.
 */
function freeName(base: string, taken: Set<string>): string {
  let name = base;
  for (let n = 1; taken.has(slugify(name)); n++) name = `${base} ${n}`.slice(0, 200);
  return name;
}

/**
 * Make the chosen groups into collections: a new top-level collection each,
 * numbered past any name of mine it would clash with. Feeds are registered
 * without fetching; the scheduler picks them up within the minute. The feeds
 * the review said won't work are not sent, and are refused here anyway.
 */
export async function commitImport(user: { id: number; rootCollectionId: number }, groups: CommitGroup[]): Promise<CommitResult> {
  const total = groups.reduce((n, g) => n + (g.feeds?.length ?? 0), 0);
  if (total > MAX_IMPORT_FEEDS) throw new ImportError(`That is more than ${MAX_IMPORT_FEEDS} feeds at once.`);
  // A collection with nothing in it is not worth making. The review already
  // refuses to keep such a group; this is the same rule where it is enforceable.
  const usable = groups.filter((g) => (g.feeds ?? []).some((f) => isHttpUrl(f.url) && !knownDead(f.url)));
  if (!usable.length) throw new ImportError("None of those folders has a feed that can be added.");
  const taken = new Set((await db.select({ slug: schema.collections.slug }).from(schema.collections).where(eq(schema.collections.userId, user.id))).map((r) => r.slug));
  const out: CommitResult["collections"] = [];
  for (const g of usable) {
    const asked = g.name?.trim().slice(0, 200);
    if (!asked) throw new ImportError("Every collection needs a name.");
    const feeds = (g.feeds ?? []).filter((f) => isHttpUrl(f.url) && !knownDead(f.url));
    const name = freeName(asked, taken);
    const [col] = await db.insert(schema.collections).values({ userId: user.id, parentId: user.rootCollectionId, name, slug: await uniqueCollectionSlug(user.id, name) }).returning();
    taken.add(col.slug);
    let added = 0;
    for (const f of feeds) {
      const feed = await ensureFeedLazy(f.url);
      if (!feed.title && f.title?.trim()) await db.update(schema.feeds).set({ title: f.title.trim() }).where(eq(schema.feeds.id, feed.id));
      await addFeedToCollection(col.id, feed.id);
      added++;
    }
    out.push({ id: col.id, name: col.name, slug: col.slug, renamedFrom: col.name === asked ? null : asked, added });
  }
  return { collections: out };
}

/**
 * Fetch an OPML document by link: a thicket collection page on any instance
 * (its URL shape is the protocol), a page that advertises OPML in its <head>,
 * or an OPML file itself. Shared by copy-by-link and the import page.
 */
export async function fetchOpml(input: string): Promise<string> {
  let target: URL;
  try {
    target = new URL(input.trim());
    if (!/^https?:$/.test(target.protocol)) throw new Error();
  } catch {
    throw new ImportError("Paste an http(s) URL.");
  }
  const m = target.pathname.match(/^\/@([^/]+)\/collections\/([^/?#]+)\/?$/);
  if (m) target = new URL(`/api/profiles/${m[1]}/collections/${m[2]}/opml`, target.origin);
  try {
    let res = await httpGet(target.toString(), { accept: "text/x-opml, application/xml, text/xml, text/html;q=0.8, */*;q=0.5" });
    if (res.status >= 400) throw new ImportError(`That URL answered ${res.status}.`);
    let text = res.body ?? "";
    if (/<html[\s>]|<!doctype html/i.test(text.slice(0, 2000))) {
      const link = [...text.slice(0, 200_000).matchAll(/<link\b[^>]*>/gi)].map((x) => x[0]).find((t) => /type\s*=\s*["']text\/x-opml["']/i.test(t));
      const href = link && /\bhref\s*=\s*["']([^"']+)["']/i.exec(link)?.[1];
      if (!href) throw new ImportError("That page doesn’t offer a collection to copy.");
      res = await httpGet(new URL(href, res.finalUrl ?? target).toString(), { accept: "text/x-opml, application/xml, text/xml" });
      if (res.status >= 400) throw new ImportError(`The collection file answered ${res.status}.`);
      text = res.body ?? "";
    }
    return text;
  } catch (err) {
    if (err instanceof ImportError) throw err;
    throw new ImportError(`Couldn’t reach that: ${err instanceof Error ? err.message : err}`);
  }
}
