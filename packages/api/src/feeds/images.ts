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
 */

export type Declared = { url?: string | null; width?: number | string | null; height?: number | string | null } | string | null | undefined;

/** Under this many pixels on a side, a declared picture is a thumbnail we should not put on a card. */
const SMALL = 100;

const num = (v: unknown) => (v === null || v === undefined || v === "" ? NaN : Number(v));

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

export function firstImg(html: string | undefined | null): string | null {
  if (!html) return null;
  const m = /<img[^>]+src=["']([^"']+)["']/i.exec(html);
  return m?.[1] ?? null;
}

/** The address when it is a web address, else null: a card never shows a data:, javascript: or other picture. */
function webUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.trim());
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/**
 * The card's picture: what the feed declared, unless that is a thumbnail, in
 * which case the first image of the body; either way asked for at full size.
 */
export function choosePreview(declared: Declared, body: string | null | undefined): string | null {
  const d = typeof declared === "string" ? { url: declared } : declared;
  const url = webUrl(d?.url);
  if (url && !isSmallImage(url, d?.width, d?.height)) return upsizeImageUrl(url);
  const body1 = webUrl(firstImg(body));
  if (body1) return upsizeImageUrl(body1);
  return url ? upsizeImageUrl(url) : null;
}
