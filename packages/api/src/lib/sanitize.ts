/**
 * Publisher HTML, made safe to show inside thicket.
 *
 * `items.content` is whatever the feed sent, whole and unmodified. Nothing
 * rendered it until the in-app reader; everything that does render it comes
 * through here first. The approach is an allowlist of the tags and attributes
 * that carry reading content, modelled on Miniflux's, plus a few rules learned
 * from this instance's own corpus (2,000 sampled bodies, 2026-09-15):
 *
 * - No scripts, ever, and nothing that runs them: script, style, form controls,
 *   object/embed, svg and math are dropped with their contents. An iframe
 *   becomes a link to what it embedded, so a YouTube post still gets you to
 *   the video without a third-party player running inside the reader.
 * - `style`, `class` and every `data-*` attribute go. 15,000 style attributes
 *   in the sample and all of them presentational noise.
 * - Tracking pixels go: any image 2px or smaller on a side (Amazon affiliate
 *   beacons, PayPal pixels, The Conversation's counters, Jetpack's 1×1
 *   resizes in this corpus), and a short list of known beacon and share-button
 *   hosts.
 * - Relative URLs are resolved against the post's own address, then the site's.
 *   Six percent of bodies here have relative image or link paths.
 * - Lazy-loaded images that hide their real source in `data-src` are rescued
 *   before the data attributes are stripped.
 * - Links open in a new tab with no referrer; images load with no referrer, so
 *   the publisher's logs learn nothing about the reader. Tracking query
 *   parameters (utm_* and friends) are trimmed from hrefs.
 * - Element ids are kept only where footnotes need them, prefixed so they can
 *   never collide with the app's own.
 */
import sanitizeHtml from "sanitize-html";

const BLOCK = ["p", "div", "br", "hr", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "code", "ul", "ol", "li", "dl", "dt", "dd",
  "figure", "figcaption", "table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption", "details", "summary", "aside"];
const INLINE = ["a", "abbr", "b", "strong", "i", "em", "u", "s", "del", "ins", "mark", "small", "sub", "sup", "kbd", "samp", "var",
  "cite", "q", "time", "span", "wbr", "dfn", "ruby", "rt", "rp", "bdi", "bdo"];
const MEDIA = ["img", "picture", "source", "video", "audio"];
/** Where an id may survive (prefixed): the two ends of a footnote, and headings for in-page links. */
const ID_TAGS = new Set(["h2", "h3", "h4", "h5", "h6", "li", "sup", "dt", "dd", "p", "a"]);

/** Beacons and share widgets that are never content. Substring match on the resolved URL. */
const IMG_BLOCKLIST = [
  "amazon-adsystem.com/e/ir", "assoc-amazon.com/e/ir", "paypalobjects.com/", "counter.theconversation.com/",
  "stats.wordpress.com", "pixel.wp.com", "feeds.feedburner.com/~r/", "feeds.feedburner.com/~ff/", "feedsportal.com",
  "facebook.com/sharer.php", "twitter.com/intent", "twitter.com/share", "x.com/intent", "x.com/share",
  "pinterest.com/pin/create/button/", "linkedin.com/shareArticle", "api.flattr.com",
];
const TRACKING_PARAMS = /^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$|_hsenc$|__hstc$|ref$)/;

export type Sanitized = {
  html: string;
  /** Characters of visible text, for judging whether this is the post or a teaser. */
  textLength: number;
  /** True when the body contains at least one image that survived. */
  hasImages: boolean;
};

/** Resolve `raw` against `base`; https for protocol-relative; null when it cannot be a URL. */
function resolve(raw: string | undefined, base: string | null): string | null {
  if (!raw) return null;
  let v = raw.trim();
  if (v.startsWith("//")) v = "https:" + v;
  try {
    return base ? new URL(v, base).href : new URL(v).href;
  } catch {
    return null;
  }
}

function stripTracking(href: string): string {
  try {
    const u = new URL(href);
    let changed = false;
    for (const k of [...u.searchParams.keys()]) if (TRACKING_PARAMS.test(k)) { u.searchParams.delete(k); changed = true; }
    return changed ? u.href : href;
  } catch {
    return href;
  }
}

/** Resolve every candidate in a srcset; drop the ones that cannot be resolved. */
function resolveSrcset(srcset: string | undefined, base: string | null): string | undefined {
  if (!srcset) return undefined;
  const out: string[] = [];
  for (const cand of srcset.split(/,\s+(?=\S)/)) {
    const [url, ...desc] = cand.trim().split(/\s+/);
    const abs = resolve(url, base);
    if (abs && /^https?:/.test(abs)) out.push([abs, ...desc].join(" "));
  }
  return out.length ? out.join(", ") : undefined;
}

const tiny = (v: string | undefined) => {
  if (v === undefined) return false;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n <= 2;
};
const positiveInt = (v: string | undefined) => (v !== undefined && /^\d+$/.test(v) && Number(v) > 0 ? v : undefined);

/** Bodies with no markup at all (YouTube descriptions, some podcast feeds) keep their line breaks as paragraphs. */
function paragraphs(text: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return text.trim().split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
}

export function sanitizeContent(dirty: string, base: string | null): Sanitized {
  if (dirty.trim() && !/<[a-z][^>]*>/i.test(dirty)) dirty = paragraphs(dirty);
  let hasImages = false;
  let textLength = 0;

  const html = sanitizeHtml(dirty, {
    allowedTags: [...BLOCK, ...INLINE, ...MEDIA],
    allowedAttributes: {
      a: ["href", "title", "id", "rel", "target", "referrerpolicy", "data-embed"],
      abbr: ["title"], dfn: ["title"],
      img: ["src", "srcset", "sizes", "alt", "title", "width", "height", "loading", "decoding", "referrerpolicy"],
      source: ["src", "srcset", "sizes", "type", "media"],
      video: ["src", "poster", "width", "height", "controls", "loop", "muted", "playsinline", "preload"],
      audio: ["src", "controls", "loop", "preload"],
      blockquote: ["cite"], q: ["cite"], del: ["cite", "datetime"], ins: ["cite", "datetime"], time: ["datetime"],
      ol: ["start", "reversed", "type"], td: ["colspan", "rowspan"], th: ["colspan", "rowspan", "scope"],
      details: ["open"], bdo: ["dir"],
      "*": ["dir", "lang", ...(["id"] as string[])],
    },
    // Dropped with everything inside them. `template` is also where hidden elements are sent to die.
    nonTextTags: ["script", "style", "noscript", "template", "title", "head", "textarea", "select", "button", "form", "object", "embed", "svg", "math"],
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesByTag: { img: ["http", "https"], source: ["http", "https"], video: ["http", "https"], audio: ["http", "https"] },
    allowedSchemesAppliedToAttributes: ["href", "src", "poster", "cite", "srcset"],
    allowProtocolRelative: false,
    parseStyleAttributes: false,
    transformTags: {
      "*": (tagName, attribs) => {
        if ("hidden" in attribs) return { tagName: "template", attribs: {} as Record<string, string> };
        if (attribs.id !== undefined) {
          if (ID_TAGS.has(tagName) && /^[\w:.-]{1,80}$/.test(attribs.id)) attribs.id = "r-" + attribs.id;
          else delete attribs.id;
        }
        return { tagName, attribs };
      },
      // The page owns its h1; the post's top heading steps down one.
      h1: (_t, attribs) => ({ tagName: "h2", attribs }),
      a: (tagName, attribs) => {
        const href = attribs.href?.trim();
        if (href && href.startsWith("#")) {
          attribs.href = "#r-" + href.slice(1);
          return { tagName, attribs: { href: attribs.href, ...(attribs.id ? { id: attribs.id } : {}) } };
        }
        const abs = resolve(href, base);
        if (!abs) { const { href: _h, ...rest } = attribs; return { tagName, attribs: rest }; }
        return { tagName, attribs: { ...attribs, href: stripTracking(abs), rel: "noopener noreferrer", target: "_blank", referrerpolicy: "no-referrer" } };
      },
      img: (tagName, attribs) => {
        // Lazy loaders park the real source in data-*; take it before those attributes are stripped.
        let src = attribs.src;
        if (!src || src.startsWith("data:")) src = attribs["data-src"] ?? attribs["data-lazy-src"] ?? attribs["data-original"] ?? src;
        const srcset = resolveSrcset(attribs.srcset ?? attribs["data-srcset"] ?? attribs["data-lazy-srcset"], base);
        const abs = resolve(src, base);
        const out: Record<string, string> = { loading: "lazy", decoding: "async", referrerpolicy: "no-referrer" };
        if (abs) out.src = abs;
        if (srcset) out.srcset = srcset;
        if (attribs.sizes) out.sizes = attribs.sizes;
        if (attribs.alt !== undefined) out.alt = attribs.alt;
        if (attribs.title) out.title = attribs.title;
        // Keep the sizes only as a marker for the pixel filter below; positive integers otherwise.
        if (attribs.width !== undefined) out.width = tiny(attribs.width) ? "0" : positiveInt(attribs.width) ?? "";
        if (attribs.height !== undefined) out.height = tiny(attribs.height) ? "0" : positiveInt(attribs.height) ?? "";
        if (out.width === "") delete out.width;
        if (out.height === "") delete out.height;
        return { tagName, attribs: out };
      },
      source: (tagName, attribs) => {
        const out: Record<string, string> = {};
        const src = resolve(attribs.src, base); if (src) out.src = src;
        const srcset = resolveSrcset(attribs.srcset, base); if (srcset) out.srcset = srcset;
        if (attribs.sizes) out.sizes = attribs.sizes;
        if (attribs.type) out.type = attribs.type;
        if (attribs.media) out.media = attribs.media;
        return { tagName, attribs: out };
      },
      video: (tagName, attribs) => {
        const out: Record<string, string> = { controls: "", preload: "none", playsinline: "" };
        const src = resolve(attribs.src, base); if (src) out.src = src;
        const poster = resolve(attribs.poster, base); if (poster) out.poster = poster;
        if (positiveInt(attribs.width)) out.width = attribs.width;
        if (positiveInt(attribs.height)) out.height = attribs.height;
        return { tagName, attribs: out };
      },
      audio: (tagName, attribs) => {
        const out: Record<string, string> = { controls: "", preload: "none" };
        const src = resolve(attribs.src, base); if (src) out.src = src;
        return { tagName, attribs: out };
      },
      // No third-party player runs in here. The embed becomes a link to itself.
      iframe: (_t, attribs) => {
        const abs = resolve(attribs.src, base);
        if (!abs || !/^https?:/.test(abs)) return { tagName: "template", attribs: {} as Record<string, string> };
        let host = "";
        try { host = new URL(abs).hostname.replace(/^www\./, ""); } catch { /* keep empty */ }
        const watch = host.includes("youtube") || host.includes("vimeo") ? "Watch" : "Open";
        return { tagName: "a", attribs: { href: abs, rel: "noopener noreferrer", target: "_blank", referrerpolicy: "no-referrer", "data-embed": host }, text: `${watch} on ${host || "the original site"}` };
      },
    },
    exclusiveFilter: (frame) => {
      if (frame.tag === "img") {
        const src = frame.attribs.src ?? "";
        if (!src && !frame.attribs.srcset) return true;
        if (frame.attribs.width === "0" || frame.attribs.height === "0") return true;
        if (IMG_BLOCKLIST.some((b) => src.includes(b))) return true;
        hasImages = true;
      }
      return false;
    },
    textFilter: (text) => { textLength += text.trim().length; return text; },
  });

  // The pixel marker never reaches the reader: an image that kept "0" was dropped above.
  return { html, textLength, hasImages };
}

/** Plain text of a body, for the length heuristics. Cheap and rough on purpose. */
export function textOf(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Does this read like the whole post, or a teaser? Feeds that truncate tend to
 * end on an ellipsis or a "read more"; short bodies from feeds that usually
 * send long ones are teasers too. Not a proof, a hint the reader can show.
 */
export function looksPartial(text: string, base: string | null): boolean {
  // A video's description is the whole of what the feed has to say about it.
  if (base && /(^|\.)(youtube\.com|youtu\.be|vimeo\.com)$/.test(hostname(base))) return false;
  const tail = text.slice(-160);
  if (/(\[…\]|\[\.\.\.\]|…|\.\.\.)\s*$/.test(tail)) return text.length < 3000;
  if (/(continue reading|read more|read the rest|full (post|article|story))\W*$/i.test(tail)) return true;
  return text.length < 600;
}

function hostname(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}
