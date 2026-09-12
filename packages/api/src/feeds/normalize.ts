/**
 * Feed URL normalization. Decided up front because the feeds table is unique
 * on this and the index is shared across every user.
 *
 * Rules:
 * - scheme and host lowercased; default ports dropped
 * - fragment dropped
 * - known tracking params dropped (utm_*, fbclid, gclid, ref, source)
 * - remaining query params sorted for stability
 * - a bare "/" path becomes "" so example.com and example.com/ match
 * - otherwise the path is left alone: trailing slashes CAN matter for feeds
 * - "www." is NOT stripped: it is a different host and some sites only serve
 *   feeds on one of the two. Redirects are followed at fetch time instead.
 */
const TRACKING = /^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$|ref$|source$)/i;

export function normalizeFeedUrl(input: string): string {
  const trimmed = input.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const u = new URL(withScheme);
  u.protocol = u.protocol.toLowerCase();
  u.hostname = u.hostname.toLowerCase();
  if ((u.protocol === "http:" && u.port === "80") || (u.protocol === "https:" && u.port === "443")) u.port = "";
  u.hash = "";
  const params = [...u.searchParams.entries()].filter(([k]) => !TRACKING.test(k)).sort(([a], [b]) => a.localeCompare(b));
  u.search = "";
  for (const [k, v] of params) u.searchParams.append(k, v);
  if (u.pathname === "/") u.pathname = "";
  return u.toString().replace(/\/$/, u.pathname === "" ? "" : "/").replace(/\/\?/, "?");
}

export function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}
