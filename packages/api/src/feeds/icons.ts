/**
 * Site icons with a quality bar. We look for the icons a site advertises,
 * prefer the big ones (apple-touch-icon, sized <link rel=icon>), fall back to
 * /favicon.ico, and keep the result only if it is a real image at least 32px
 * wide. Anything that fails renders as a monogram in the UI. Icons are cached
 * in Postgres and served from our own origin, so a dead or slow site can never
 * break a card, and the browser never hits third-party hosts.
 */
import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import { USER_AGENT } from "./http.js";

const MIN_WIDTH = 32;
/** An icon shared by this many distinct sites is a platform default, not a brand. */
export const GENERIC_THRESHOLD = 3;
const MAX_BYTES = 512 * 1024;
const TIMEOUT_MS = 10_000;
export const ICON_RECHECK_MS = 30 * 24 * 3600 * 1000;

type Candidate = { url: string; declaredSize: number; rank: number };

/** Parse <link rel="..."> icon tags out of a page head. Ranked: apple-touch-icon > sized icon > plain icon. */
export function extractIconLinks(html: string, baseUrl: string): Candidate[] {
  const out: Candidate[] = [];
  const head = html.slice(0, 200_000);
  for (const tag of head.match(/<link\b[^>]*>/gi) ?? []) {
    const attr = (name: string) => new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(tag)?.[1];
    const rels = (attr("rel") ?? "").toLowerCase().split(/\s+/);
    const href = attr("href");
    if (!href) continue;
    const isApple = rels.includes("apple-touch-icon") || rels.includes("apple-touch-icon-precomposed");
    const isIcon = rels.includes("icon");
    if (!isApple && !isIcon) continue;
    const sizes = attr("sizes") ?? "";
    const declaredSize = Math.max(0, ...[...sizes.matchAll(/(\d+)x\d+/gi)].map((m) => Number(m[1])), sizes.toLowerCase() === "any" ? 512 : 0);
    try {
      const url = new URL(href, baseUrl).toString();
      if (!/^https?:/.test(url)) continue;
      out.push({ url, declaredSize: isApple && !declaredSize ? 180 : declaredSize, rank: isApple ? 2 : declaredSize >= 32 ? 1 : 0 });
    } catch {
      /* skip */
    }
  }
  return out.sort((a, b) => b.rank - a.rank || b.declaredSize - a.declaredSize);
}

/** Width in pixels from the image header, or null if unknown/invalid. SVG returns Infinity (scales). */
export function imageWidth(buf: Buffer, contentType: string): number | null {
  if (buf.length < 12) return null;
  // PNG
  if (buf[0] === 0x89 && buf.subarray(1, 4).toString("latin1") === "PNG") return buf.length >= 24 ? buf.readUInt32BE(16) : null;
  // GIF
  if (buf.subarray(0, 3).toString("latin1") === "GIF") return buf.readUInt16LE(6);
  // JPEG: walk segments to SOF
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) return null;
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return buf.readUInt16BE(i + 7);
      i += 2 + len;
    }
    return null;
  }
  // WebP (VP8/VP8L/VP8X)
  if (buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP" && buf.length >= 30) {
    const chunk = buf.subarray(12, 16).toString("latin1");
    if (chunk === "VP8X") return 1 + buf.readUIntLE(24, 3);
    if (chunk === "VP8L") return 1 + (buf.readUInt32LE(21) & 0x3fff);
    if (chunk === "VP8 ") return buf.readUInt16LE(26) & 0x3fff;
    return null;
  }
  // ICO: pick the largest directory entry (0 means 256)
  if (buf[0] === 0 && buf[1] === 0 && buf[2] === 1 && buf[3] === 0) {
    const n = buf.readUInt16LE(4);
    let best = 0;
    for (let k = 0; k < n && 6 + k * 16 < buf.length; k++) {
      const w = buf[6 + k * 16] || 256;
      best = Math.max(best, w);
    }
    return best || null;
  }
  // SVG
  if (/svg/i.test(contentType) || /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg/i.test(buf.subarray(0, 512).toString("utf8"))) return Number.POSITIVE_INFINITY;
  return null;
}

async function fetchIcon(url: string): Promise<{ buf: Buffer; contentType: string; width: number } | null> {
  try {
    const res = await fetch(url, { headers: { "user-agent": USER_AGENT, accept: "image/*,*/*;q=0.5" }, redirect: "follow", signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > MAX_BYTES) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 64 || buf.length > MAX_BYTES) return null;
    let contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const width = imageWidth(buf, contentType);
    if (width === null) return null; // HTML error pages, empty files, unknown formats
    if (!contentType.startsWith("image/")) {
      // Servers lie about favicon types constantly; trust the sniffed format instead.
      contentType = width === Number.POSITIVE_INFINITY ? "image/svg+xml" : buf[0] === 0x89 ? "image/png" : buf[0] === 0xff ? "image/jpeg" : buf[0] === 0 ? "image/x-icon" : buf[0] === 0x47 ? "image/gif" : "image/webp";
    }
    if (width < MIN_WIDTH) return null;
    return { buf, contentType, width: Number.isFinite(width) ? width : 0 };
  } catch {
    return null;
  }
}

/**
 * Find and cache an icon for a feed. Cheap when it fails; we record the attempt
 * so the scheduler won't retry for a month. Returns true if an icon was stored.
 */
export async function refreshIcon(feedId: number, siteUrl: string | null, feedUrl: string): Promise<boolean> {
  const base = siteUrl ?? new URL(feedUrl).origin;
  const mark = () => db.update(schema.feeds).set({ iconCheckedAt: new Date() }).where(eq(schema.feeds.id, feedId));
  let candidates: Candidate[] = [];
  try {
    const res = await fetch(base, { headers: { "user-agent": USER_AGENT, accept: "text/html,*/*;q=0.5" }, redirect: "follow", signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.ok) {
      const html = (await res.text()).slice(0, 300_000);
      candidates = extractIconLinks(html, res.url || base);
      candidates.push({ url: new URL("/favicon.ico", res.url || base).toString(), declaredSize: 0, rank: -1 });
    }
  } catch {
    candidates = [{ url: new URL("/favicon.ico", base).toString(), declaredSize: 0, rank: -1 }];
  }
  // Try best-ranked first; stop at the first one that passes the bar. Cap attempts to stay polite.
  for (const c of candidates.slice(0, 4)) {
    const got = await fetchIcon(c.url);
    if (!got) continue;
    const hash = createHash("sha256").update(got.buf).digest("hex");
    const row = { sourceUrl: c.url, contentType: got.contentType, width: got.width || null, bytes: got.buf, hash, fetchedAt: new Date() };
    await db.insert(schema.feedIcons).values({ feedId, ...row }).onConflictDoUpdate({ target: schema.feedIcons.feedId, set: row });
    await markGeneric(hash);
    await mark();
    return true;
  }
  await db.delete(schema.feedIcons).where(eq(schema.feedIcons.feedId, feedId));
  await mark();
  return false;
}

/** Recompute the platform-default flag for every icon sharing this hash. */
export async function markGeneric(hash: string): Promise<void> {
  await db.execute(sql`
    update feed_icons set generic = (
      select count(distinct lower(split_part(coalesce(f.site_url, f.url), '/', 3))) >= ${GENERIC_THRESHOLD}
      from feed_icons x join feeds f on f.id = x.feed_id where x.hash = ${hash}
    ) where hash = ${hash}
  `);
}

/** Recompute the flag for all icons (used by the backfill script). Returns how many are generic. */
export async function markAllGeneric(): Promise<number> {
  const res = await db.execute<{ n: number }>(sql`
    with counts as (
      select x.hash, count(distinct lower(split_part(coalesce(f.site_url, f.url), '/', 3))) as sites
      from feed_icons x join feeds f on f.id = x.feed_id group by x.hash
    )
    update feed_icons fi set generic = (c.sites >= ${GENERIC_THRESHOLD}) from counts c where c.hash = fi.hash
  `);
  void res;
  const count = await db.execute<{ n: number }>(sql`select count(*)::int as n from feed_icons where generic`);
  return count.rows[0]?.n ?? 0;
}
