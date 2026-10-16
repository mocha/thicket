/**
 * Which picture a post gets on its card, and asking known hosts for the big
 * version of it.
 *
 * A feed often declares a picture (media:thumbnail, an enclosure) and that is
 * the publisher's choice, so it wins. But a thumbnail is by definition the
 * small version, and on some hosts it is tiny: Blogger's is 72 pixels. When
 * the declared picture is under 100 pixels on a side, the first image in the
 * post body stands in for it, which is what the publisher put first, not what
 * we think is best. Then, wherever the address itself says "give me the small
 * one", it is rewritten to ask for the large one. Only hosts whose URL scheme
 * we know are touched; anything else is left exactly as published.
 *
 * A tracking pixel is never the picture, declared or in the body: NPR puts
 * one in every post, and on a card it shows as an empty picture frame.
 */

import { isBeaconImage } from "../lib/sanitize.js";

export type Declared = { url?: string | null; width?: number | string | null; height?: number | string | null } | string | null | undefined;

/** Under this many pixels on a side, a declared picture is a thumbnail we should not put on a card. */
const SMALL = 100;

const num = (v: unknown) => (v === null || v === undefined || v === "" ? NaN : Number(v));

/** 2 pixels or smaller on a side: a tracking pixel, never a picture. */
const isPixelSize = (width: unknown, height: unknown) => num(width) <= 2 || num(height) <= 2;

/** Is this picture small, by its declared size or by a size written into its address? */
export function isSmallImage(url: string, width?: number | string | null, height?: number | string | null): boolean {
  const w = num(width), h = num(height);
  if ((w > 0 && w < SMALL) || (h > 0 && h < SMALL)) return true;
  // Blogger: /s72-c/, /s72-w640-h352-c/, /w72-h72/
  const b = /(?:googleusercontent\.com|bp\.blogspot\.com)\/.*\/(?:s(\d+)|w(\d+)-h(\d+))(?:-[a-z0-9-]+)?\/[^/]*$/i.exec(url);
  if (b) { const s = num(b[1]), bw = num(b[2]), bh = num(b[3]); if ((s > 0 && s < SMALL) || (bw > 0 && bw < SMALL) || (bh > 0 && bh < SMALL)) return true; }
  // WordPress: ?w=64 or photo-64x64.jpg
  const q = /[?&](?:w|h|resize|fit)=(\d+)/i.exec(url);
  if (q && num(q[1]) < SMALL) return true;
  const f = /-(\d+)x(\d+)\.(?:jpe?g|png|gif|webp|avif)(?:$|\?)/i.exec(url);
  if (f && (num(f[1]) < SMALL || num(f[2]) < SMALL)) return true;
  // Gravatar and the like: an avatar, not a picture of the post.
  if (/gravatar\.com\/avatar\//i.test(url)) return true;
  return false;
}

/** Where the address carries a size, ask for the large version. Known hosts only. */
export function upsizeImageUrl(url: string): string {
  if (/(?:googleusercontent\.com|bp\.blogspot\.com)\//i.test(url)) {
    return url.replace(/\/(?:s\d+|w\d+-h\d+)(?:-[a-z0-9-]+)?\/([^/]*)$/i, "/s1600/$1");
  }
  if (/(?:\.files\.wordpress\.com|\.wp\.com)\//i.test(url)) {
    try {
      const u = new URL(url);
      for (const k of ["w", "h", "resize", "fit", "crop", "zoom"]) u.searchParams.delete(k);
      return u.toString();
    } catch { return url; }
  }
  if (/\/wp-content\/uploads\//i.test(url)) {
    return url.replace(/-\d+x\d+(\.(?:jpe?g|png|gif|webp|avif))(?=$|\?)/i, "$1");
  }
  if (/substackcdn\.com\/image\/fetch\//i.test(url)) {
    return url.replace(/\/fetch\/w_\d+,/, "/fetch/w_1456,");
  }
  return url;
}

/** Each <img> in the body with the size its attributes give, in order. A percentage is not a size. */
function* bodyImages(html: string): Generator<{ src: string; width?: string; height?: string }> {
  for (const [tag] of html.matchAll(/<img\b[^>]*>/gi)) {
    const src = /\ssrc=["']([^"']+)["']/i.exec(tag)?.[1];
    if (src) yield { src, width: /\swidth=["']?(\d+)(?![\d%])/i.exec(tag)?.[1], height: /\sheight=["']?(\d+)(?![\d%])/i.exec(tag)?.[1] };
  }
}

/**
 * The body's first image that could be a post's picture. Not a tracking pixel
 * (a known beacon, or 2 pixels or smaller on a side), and not small: an icon,
 * emoji or avatar beside the text, like the 17-pixel user icon Dreamwidth puts
 * by every name, fills a card's frame as a blur.
 */
export function firstImg(html: string | undefined | null): string | null {
  if (!html) return null;
  for (const { src, width, height } of bodyImages(html)) {
    if (isBeaconImage(src) || isPixelSize(width, height) || isSmallImage(src, width, height)) continue;
    return src;
  }
  return null;
}

/**
 * The card's picture again, for a post already stored. The stored picture is
 * taken as the declared one, unless it is one of the body's own images: then
 * the size the body gives it counts, and if that makes it a pixel or small
 * (an icon picked before body images had to be large), it is judged as a
 * fresh parse judges body images, with no small last resort to fall back to.
 */
export function repickPreview(stored: string, body: string | null | undefined, base?: string | null): string | null {
  for (const img of body ? bodyImages(body) : []) {
    if (webUrl(img.src, base) !== stored) continue;
    if (isPixelSize(img.width, img.height) || isSmallImage(stored, img.width, img.height)) return choosePreview(null, body, base);
    break;
  }
  return choosePreview(stored, body, base);
}

/**
 * The address made absolute against base (the post's address, else the
 * site's), when it is a web address; else null. "//cdn.example.com/a.jpg" and
 * "/a.jpg" are fine and get the base's scheme and host; a card never shows a
 * data:, javascript: or other picture.
 */
function webUrl(url: string | null | undefined, base?: string | null): string | null {
  if (!url) return null;
  try {
    url = url.trim();
    // With no base, a "//host/path" address still names a host: assume https.
    const u = new URL(!base && url.startsWith("//") ? `https:${url}` : url, base ?? undefined);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/**
 * The card's picture: what the feed declared, unless that is a thumbnail, in
 * which case the first image of the body; either way asked for at full size.
 * base is where a partial address like "//cdn.example.com/a.jpg" is read from.
 */
export function choosePreview(declared: Declared, body: string | null | undefined, base?: string | null): string | null {
  const d = typeof declared === "string" ? { url: declared } : declared;
  const declaredUrl = webUrl(d?.url, base);
  const url = declaredUrl && !isBeaconImage(declaredUrl) && !isPixelSize(d?.width, d?.height) ? declaredUrl : null;
  if (url && !isSmallImage(url, d?.width, d?.height)) return upsizeImageUrl(url);
  const body1 = webUrl(firstImg(body), base);
  if (body1) return upsizeImageUrl(body1);
  return url ? upsizeImageUrl(url) : null;
}
