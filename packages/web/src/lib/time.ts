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
 * How often something posts, in words. `n` is posts in the last 30 days, so
 * this is already a monthly rate; below one a month it is the rate that is
 * uncertain, not the wording, hence "less than".
 */
export function postRate(n: number): string {
  if (n <= 0) return '';
  if (n >= 60) return `~${Math.round(n / 30)} posts per day`;
  if (n >= 8) return `~${Math.round(n / 4.35)} posts per week`;
  return `~${n} post${n === 1 ? '' : 's'} per month`;
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
