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
