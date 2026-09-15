/**
 * Turn any feed document into thicket's normalized shape. This is the only
 * place that knows about feed formats; adding ActivityPub later means adding
 * another adapter that produces ParsedFeed, nothing downstream changes.
 */
import { createHash } from "node:crypto";
import { parseFeed } from "feedsmith";

export type ParsedItem = {
  dedupeKey: string;
  url: string | null;
  title: string | null;
  author: string | null;
  /** Plain text for the river card, capped at SUMMARY_LEN. A display string, never the record. */
  summary: string | null;
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
  items: ParsedItem[];
};

const SUMMARY_LEN = 280;

export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

function summarize(...candidates: Array<string | undefined | null>): string | null {
  for (const c of candidates) {
    if (!c) continue;
    const text = stripHtml(c);
    if (!text) continue;
    return text.length > SUMMARY_LEN ? text.slice(0, SUMMARY_LEN - 1).trimEnd() + "…" : text;
  }
  return null;
}

function firstImg(html: string | undefined | null): string | null {
  if (!html) return null;
  const m = /<img[^>]+src=["']([^"']+)["']/i.exec(html);
  return m?.[1] ?? null;
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

function absolutize(href: string | null | undefined, base: string | null): string | null {
  if (!href) return null;
  // Some generators emit "www.example.com/post" with no scheme. Treat a leading www. as a host, not a path.
  if (/^www\./i.test(href)) href = `https://${href}`;
  try {
    return new URL(href, base ?? undefined).toString();
  } catch {
    return href;
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
    const siteUrl = f.link ?? null;
    for (const it of f.items ?? []) {
      const rich: string | null = it.content?.encoded ?? null;
      const permalinkGuid = it.guid?.isPermaLink && /^https?:\/\//.test(it.guid?.value ?? "") ? it.guid.value : null;
      const link = absolutize(it.link ?? permalinkGuid, siteUrl ?? feedUrl);
      const title = it.title ? stripHtml(it.title) : null;
      const body = rich ?? it.description ?? null;
      const mediaText = mediaDescription(it.media);
      const mediaThumb = it.media?.thumbnails?.[0]?.url ?? it.media?.groups?.[0]?.thumbnails?.[0]?.url ?? it.media?.contents?.find((c: any) => c.medium === "image")?.url;
      const enclosureImg = it.enclosures?.find((e: any) => e.type?.startsWith("image/"))?.url;
      items.push({
        dedupeKey: dedupeKey(it.guid?.value, link, title, body),
        url: link,
        title,
        author: cleanAuthor(it.dc?.creators?.[0]) ?? cleanAuthor(it.authors?.[0]),
        summary: summarize(it.description, rich, mediaText),
        content: body ?? mediaText,
        imageUrl: mediaThumb ?? enclosureImg ?? firstImg(body) ?? null,
        publishedAt: toDate(it.pubDate) ?? toDate(it.dc?.dates?.[0]) ?? null,
      });
    }
    return { kind: format, title: f.title ? stripHtml(f.title) : null, description: f.description ? stripHtml(f.description) : null, siteUrl, items };
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
      items.push({
        dedupeKey: dedupeKey(e.id, link, title, body),
        url: link,
        title,
        author: e.authors?.[0]?.name ?? f.authors?.[0]?.name ?? null,
        summary: summarize(e.summary, rich, mediaText),
        content: body ?? mediaText,
        imageUrl: e.media?.thumbnails?.[0]?.url ?? e.media?.groups?.[0]?.thumbnails?.[0]?.url ?? firstImg(body),
        publishedAt: toDate(e.published) ?? toDate(e.updated) ?? null,
      });
    }
    return { kind: "atom", title: f.title ? stripHtml(f.title) : null, description: f.subtitle ? stripHtml(f.subtitle) : null, siteUrl, items };
  }

  // json
  const f = feed as any;
  const siteUrl = f.home_page_url ?? null;
  for (const it of f.items ?? []) {
    const link = absolutize(it.url ?? it.external_url ?? null, siteUrl ?? feedUrl);
    const title = it.title ? stripHtml(it.title) : null;
    const rich: string | null = it.content_html ?? it.content_text ?? null;
    const body = rich ?? it.summary ?? null;
    items.push({
      dedupeKey: dedupeKey(it.id, link, title, rich),
      url: link,
      title,
      author: it.authors?.[0]?.name ?? f.authors?.[0]?.name ?? null,
      summary: summarize(it.summary, it.content_text, it.content_html),
      content: body,
      imageUrl: it.image ?? it.banner_image ?? firstImg(it.content_html),
      publishedAt: toDate(it.date_published) ?? toDate(it.date_modified) ?? null,
    });
  }
  return { kind: "json", title: f.title ?? null, description: f.description ?? null, siteUrl, items };
}
