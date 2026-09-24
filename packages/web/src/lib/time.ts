export function relativeTime(iso: string, now = Date.now()): string {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = s / 60;
  if (m < 60) return `${Math.floor(m)}m`;
  const h = m / 60;
  if (h < 24) return `${Math.floor(h)}h`;
  const d = h / 24;
  if (d < 7) return `${Math.floor(d)}d`;
  const date = new Date(iso);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString(undefined, sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * "13 minutes ago", not "13m". The river is scanned, so it gets the short
 * form; a directory entry is read, and a reader deciding whether to follow
 * something should not have to decode it.
 */
export function longAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  const units: [number, string][] = [[60, 'minute'], [60, 'hour'], [24, 'day'], [7, 'week'], [4.35, 'month'], [12, 'year']];
  let v = s;
  let name = 'second';
  for (const [step, next] of units) {
    if (v < step) break;
    v /= step;
    name = next;
  }
  if (name === 'second' && v < 60) return 'just now';
  const n = Math.max(1, Math.floor(v));
  return `${n} ${name}${n === 1 ? '' : 's'} ago`;
}

/**
 * A count of posts over the last 30 days, restated as the plainest rate: a day
 * when there are plenty, a week when there are some, otherwise a month (the
 * count itself, since the window already is a month).
 */
export function perPeriod(n: number): { n: number; unit: 'day' | 'week' | 'month' } {
  if (n >= 60) return { n: Math.round(n / 30), unit: 'day' };
  if (n >= 8) return { n: Math.round(n / 4.35), unit: 'week' };
  return { n, unit: 'month' };
}

/** How often something posts, in words ("9 posts a day"). `n` is posts in the last 30 days. */
export function postRate(n: number): string {
  if (n <= 0) return '';
  const r = perPeriod(n);
  return `${r.n} post${r.n === 1 ? '' : 's'} a ${r.unit}`;
}

/**
 * The line under a feed's name. Normally the site's host. When another feed on
 * this instance has the same title (a site's main feed and one of its section
 * feeds, say), the feed's own host and path, so the two can be told apart.
 */
export function feedOrigin(f: { url: string; siteUrl: string | null; sameTitle?: number }): string {
  if ((f.sameTitle ?? 1) > 1) {
    try { const u = new URL(f.url); return u.hostname.replace(/^www\./, '') + u.pathname.replace(/\/$/, ''); } catch { return f.url; }
  }
  return hostOf(f.siteUrl ?? f.url);
}

/**
 * The link itself when it is a web address, else null. Feeds and saved posts
 * supply these links, and an href of javascript: would run code when clicked,
 * so anything other than http or https is never made clickable.
 */
export function webHref(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/**
 * A bookmark's link, made safe the same way: a web address, or a post's own
 * page here, which is what a post with no link of its own is saved under.
 * Anything else is never made clickable.
 */
export function savedHref(url: string | null | undefined): string | null {
  if (url && /^\/feeds\/\d+\/[a-z0-9-]+\/\d+$/.test(url)) return url;
  return webHref(url);
}

export function hostOf(url: string | null): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** Local calendar day as YYYY-MM-DD, so two posts can be compared by day and the keys sort. */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * The heading over a day's posts in the river. Today is "Latest posts";
 * yesterday says so; anything older is spelled out, with the year once it
 * differs. Weekday included because "September 9" alone loses its place fast.
 */
export function dayLabel(key: string, now = new Date()): string {
  const today = dayKey(now);
  if (key >= today) return 'Latest posts';
  const y = new Date(now); y.setDate(y.getDate() - 1);
  if (key === dayKey(y)) return 'Yesterday';
  const [Y, M, D] = key.split('-').map(Number);
  const d = new Date(Y, M - 1, D);
  return d.toLocaleDateString(undefined, Y === now.getFullYear() ? { weekday: 'long', month: 'long', day: 'numeric' } : { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}
