/**
 * Turn any feed document into thicket's normalized shape. This is the only
 * place that knows about feed formats; adding ActivityPub later means adding
 * another adapter that produces ParsedFeed, nothing downstream changes.
 */
import { createHash } from "node:crypto";
import { parseFeed } from "feedsmith";
import { decodeHTML } from "entities";
import { choosePreview } from "./images.js";

export type ParsedItem = {
  dedupeKey: string;
  url: string | null;
  title: string | null;
  author: string | null;
  /** Plain text for the river card, capped at SUMMARY_LEN. A display string, never the record. */
  summary: string | null;
  /**
   * When the whole description is a single link pointing somewhere other than
   * this post — Hacker News's "Comments" link to the discussion — that link,
   * to show on the card in place of a summary. linkLabel is the link's own
   * words. Both null for an ordinary post.
   */
  linkUrl: string | null;
  linkLabel: string | null;
  /**
   * Everything the publisher gave us for this item's body, whole: the rich
   * field (`content:encoded`, Atom `<content>`, `content_html`) when there is
   * one, otherwise the description. Both are stored at full length.
   *
   * These used to be different columns' business — rich content here, the
   * description only ever as a 280-character `summary`. That silently discarded
   * the rest of the description for 46% of the index, and since most feeds
   * expose only their newest 10–25 entries, anything that scrolled out of the
   * window was gone for good. Feeds hand us this text; the least we can do is
   * keep it.
   */
  content: string | null;
  imageUrl: string | null;
  publishedAt: Date | null;
};

export type ParsedFeed = {
  kind: "rss" | "atom" | "json" | "rdf";
  title: string | null;
  description: string | null;
  siteUrl: string | null;
  /** The image the feed declares for itself: RSS <image>, Atom <icon>/<logo>, JSON Feed icon or author avatar. An account's picture, for feeds that are accounts (feeds/icons.ts). */
  image: string | null;
  items: ParsedItem[];
};

const SUMMARY_LEN = 280;

/**
 * HTML to the plain text that titles, summaries and author names are made of.
 *
 * The entities are decoded by a full HTML5 table rather than the handful this
 * once knew (&amp;, &lt;, &gt;, &quot;, &#39;, decimal numerics). Publishers
 * write &rsquo;, &ldquo;, &mdash; and &#x2019; constantly, and a feed that
 * escapes its own escapes — &amp;rsquo; in the document — arrives here as
 * &rsquo; once the XML parser has had its turn. Anything this did not know
 * was stored verbatim and shown to the reader as "&rsquo;", in the card, the
 * title and the address bar.
 *
 * Order matters: tags go first, so no entity can be decoded into one, and
 * whitespace is collapsed last, so a decoded &nbsp; folds into the space
 * beside it. Decoding is one pass — "&amp;rsquo;" becomes "&rsquo;" and stops
 * there, which is what the publisher wrote.
 */
export function stripHtml(html: string): string {
  return decodeHTML(
    html
      .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * True when every bit of visible text lives inside a link, so stripping the
 * markup would leave only the link's own words. Hacker News hands each post a
 * description that is a single link reading "Comments" pointing at the thread;
 * "Read more" and a bare "Permalink" have the same shape. None of these
 * describes the post, so we treat them as no summary at all rather than show
 * the word to the reader. A description with any text of its own outside a
 * link keeps that text.
 */
export function isLinkOnly(html: string): boolean {
  return stripHtml(html.replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, " ")) === "";
}

function summarize(...candidates: Array<string | undefined | null>): string | null {
  for (const c of candidates) {
    if (!c) continue;
    const text = stripHtml(c);
    if (!text) continue;
    if (isLinkOnly(c)) continue;
    return text.length > SUMMARY_LEN ? text.slice(0, SUMMARY_LEN - 1).trimEnd() + "…" : text;
  }
  return null;
}

/**
 * The href and words of the lone link in a link-only description, so we can
 * keep it (Hacker News's "Comments" link to the discussion) instead of
 * dropping it. Null when the text isn't link-only or the anchor has no usable
 * href or words.
 */
export function linkOnly(html: string): { url: string; label: string } | null {
  if (!isLinkOnly(html)) return null;
  const m = /<a\b[^>]*?\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/i.exec(html);
  if (!m) return null;
  const url = (m[1] ?? m[2] ?? m[3] ?? "").trim();
  const label = stripHtml(m[4] ?? "");
  return url && label ? { url, label } : null;
}

/** Two URLs equal but for a trailing slash. */
function sameUrl(a: string | null, b: string | null): boolean {
  return !!a && !!b && a.replace(/\/+$/, "") === b.replace(/\/+$/, "");
}

/**
 * A card's summary, and — when the description is nothing but a link that goes
 * somewhere other than the post itself — that link to show in its place. A real
 * text summary wins and carries no link; a lone link back to the post the card
 * already opens is dropped as redundant.
 */
function summarizeWithLink(cands: Array<string | undefined | null>, itemUrl: string | null, base: string | null): { summary: string | null; linkUrl: string | null; linkLabel: string | null } {
  const summary = summarize(...cands);
  if (summary !== null) return { summary, linkUrl: null, linkLabel: null };
  for (const c of cands) {
    const l = c ? linkOnly(c) : null;
    if (!l) continue;
    const url = absolutize(l.url, base);
    if (url && !sameUrl(url, itemUrl)) return { summary: null, linkUrl: url, linkLabel: l.label };
    break;
  }
  return { summary: null, linkUrl: null, linkLabel: null };
}

function toDate(v: unknown): Date | null {
  if (!v) return null;
  const d = new Date(v as string);
  return Number.isNaN(d.getTime()) ? null : d;
}

function cleanAuthor(a: unknown): string | null {
  if (typeof a !== "string") return null;
  const s = stripHtml(a);
  const paren = /\(([^)]+)\)/.exec(s);
  if (paren) return paren[1].trim() || null;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return null;
  return s || null;
}

function hash(s: string): string {
  return createHash("sha1").update(s).digest("hex");
}

/** guid → link → hash(title + summary). Feeds lie constantly; this is the fallback chain. */
function dedupeKey(guid: string | undefined | null, link: string | null, title: string | null, body: string | null): string {
  if (guid && guid.trim()) return `guid:${guid.trim()}`;
  if (link) return `link:${link}`;
  return `hash:${hash(`${title ?? ""}\n${body ?? ""}`)}`;
}

/**
 * A feed-supplied link made absolute, or null. Every link a feed hands us ends
 * up clickable (or fetched), so only a web address survives — never
 * javascript:, data:, mailto: or the like from a hostile or careless feed.
 */
function absolutize(href: string | null | undefined, base: string | null): string | null {
  if (!href) return null;
  href = href.trim();
  // Some generators emit "www.example.com/post" with no scheme. Treat a leading www. as a host, not a path.
  if (/^www\./i.test(href)) href = `https://${href}`;
  try {
    const u = new URL(href, base ?? undefined);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Media RSS's description: media:description inside media:group, or on the
 * item itself. YouTube's feeds carry a video's whole description there and
 * nowhere else, so until 2026-09-15 every YouTube post was stored as a bare
 * title and search could only ever match video titles. Plain text, not HTML.
 */
function mediaDescription(media: any): string | null {
  const v = media?.groups?.[0]?.description?.value ?? media?.description?.value ?? null;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export function parseFeedDocument(text: string, feedUrl: string): ParsedFeed {
  const { format, feed } = parseFeed(text);
  const items: ParsedItem[] = [];

  // The media description is a last resort for the body, and is kept out of
  // dedupeKey on purpose: a key that changed would store every post again.
  if (format === "rss" || format === "rdf") {
    const f = feed as any;
    const siteUrl = absolutize(f.link ?? null, feedUrl);
    for (const it of f.items ?? []) {
      const rich: string | null = it.content?.encoded ?? null;
      const permalinkGuid = it.guid?.isPermaLink && /^https?:\/\//.test(it.guid?.value ?? "") ? it.guid.value : null;
      const link = absolutize(it.link ?? permalinkGuid, siteUrl ?? feedUrl);
      const title = it.title ? stripHtml(it.title) : null;
      const body = rich ?? it.description ?? null;
      const mediaText = mediaDescription(it.media);
      const mediaThumb = it.media?.thumbnails?.[0] ?? it.media?.groups?.[0]?.thumbnails?.[0] ?? it.media?.contents?.find((c: any) => c.medium === "image");
      const enclosureImg = it.enclosures?.find((e: any) => e.type?.startsWith("image/"))?.url;
      const sl = summarizeWithLink([it.description, rich, mediaText], link, siteUrl ?? feedUrl);
      items.push({
        dedupeKey: dedupeKey(it.guid?.value, link, title, body),
        url: link,
        title,
        author: cleanAuthor(it.dc?.creators?.[0]) ?? cleanAuthor(it.authors?.[0]),
        summary: sl.summary,
        linkUrl: sl.linkUrl,
        linkLabel: sl.linkLabel,
        // A body that is nothing but a link isn't content — keeping it would
        // feed the search index the link's bare word ("Comments"). The link
        // itself is already held in linkUrl. A media-only body (a lone image or
        // video, also textless) is real content and stays.
        content: body && !linkOnly(body) ? body : mediaText,
        imageUrl: choosePreview(mediaThumb ?? enclosureImg, body, link ?? siteUrl ?? feedUrl),
        publishedAt: toDate(it.pubDate) ?? toDate(it.dc?.dates?.[0]) ?? null,
      });
    }
    const image = absolutize(f.image?.url ?? null, feedUrl);
    return { kind: format, title: f.title ? stripHtml(f.title) : null, description: f.description ? stripHtml(f.description) : null, siteUrl, image, items };
  }

  if (format === "atom") {
    const f = feed as any;
    const pick = (links: any[] | undefined, rel: string) => links?.find((l) => (l.rel ?? "alternate") === rel && (!l.type || l.type.includes("html")))?.href ?? links?.find((l) => (l.rel ?? "alternate") === rel)?.href;
    const siteUrl = absolutize(pick(f.links, "alternate") ?? null, feedUrl);
    for (const e of f.entries ?? []) {
      const link = absolutize(pick(e.links, "alternate") ?? null, siteUrl ?? feedUrl);
      const title = e.title ? stripHtml(e.title) : null;
      const rich: string | null = e.content ?? null;
      const body = rich ?? e.summary ?? null;
      const mediaText = mediaDescription(e.media);
      const sl = summarizeWithLink([e.summary, rich, mediaText], link, siteUrl ?? feedUrl);
      items.push({
        dedupeKey: dedupeKey(e.id, link, title, body),
        url: link,
        title,
        author: e.authors?.[0]?.name ?? f.authors?.[0]?.name ?? null,
        summary: sl.summary,
        linkUrl: sl.linkUrl,
        linkLabel: sl.linkLabel,
        content: body && !linkOnly(body) ? body : mediaText,
        imageUrl: choosePreview(e.media?.thumbnails?.[0] ?? e.media?.groups?.[0]?.thumbnails?.[0], body, link ?? siteUrl ?? feedUrl),
        publishedAt: toDate(e.published) ?? toDate(e.updated) ?? null,
      });
    }
    const image = absolutize(f.icon ?? f.logo ?? null, feedUrl);
    return { kind: "atom", title: f.title ? stripHtml(f.title) : null, description: f.subtitle ? stripHtml(f.subtitle) : null, siteUrl, image, items };
  }

  // json
  const f = feed as any;
  const siteUrl = absolutize(f.home_page_url ?? null, feedUrl);
  for (const it of f.items ?? []) {
    const link = absolutize(it.url ?? it.external_url ?? null, siteUrl ?? feedUrl);
    const title = it.title ? stripHtml(it.title) : null;
    const rich: string | null = it.content_html ?? it.content_text ?? null;
    const body = rich ?? it.summary ?? null;
    const sl = summarizeWithLink([it.summary, it.content_text, it.content_html], link, siteUrl ?? feedUrl);
    items.push({
      dedupeKey: dedupeKey(it.id, link, title, rich),
      url: link,
      title,
      author: it.authors?.[0]?.name ?? f.authors?.[0]?.name ?? null,
      summary: sl.summary,
      linkUrl: sl.linkUrl,
      linkLabel: sl.linkLabel,
      content: body && !linkOnly(body) ? body : null,
      imageUrl: choosePreview(it.image ?? it.banner_image, it.content_html, link ?? siteUrl ?? feedUrl),
      publishedAt: toDate(it.date_published) ?? toDate(it.date_modified) ?? null,
    });
  }
  const image = absolutize(f.icon ?? f.authors?.[0]?.avatar ?? f.author?.avatar ?? f.favicon ?? null, feedUrl);
  return { kind: "json", title: f.title ? stripHtml(f.title) : null, description: f.description ? stripHtml(f.description) : null, siteUrl, image, items };
}
