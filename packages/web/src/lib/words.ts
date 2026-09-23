/**
 * Saying what a search result is made of, in words.
 *
 * A feed row answers the question a person searching is really asking: if I
 * follow this, how much of it will be about my topic? So it gives a rate over
 * the last 30 days ("about 2 posts a day mention 'news'"), the same window as
 * the feed's own posting rate beside it, and the two read as one comparison.
 */
import { perPeriod, relativeTime } from './time';

/** "~2 posts a day mention", ready for the search words to follow. `n` is matches in the last 30 days. */
export function mentionRate(n: number): string {
  const r = perPeriod(n);
  return `~${r.n} post${r.n === 1 ? '' : 's'} a ${r.unit} mention${r.n === 1 ? 's' : ''}`;
}

/**
 * "latest 13h ago", the short time form, which directory lists otherwise spell
 * out. It is the one exception, so the search line fits on one row beside the
 * Follow button. Past a week the short form is a date, which takes no "ago".
 */
export function latestShort(iso: string): string {
  const t = relativeTime(iso);
  return /^\d+[mhd]$/.test(t) ? `latest ${t} ago` : `latest ${t}`;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** ts_headline fences the matched words with these; see routes/search.ts. */
const OPEN = '\u0001';
const CLOSE = '\u0002';

/**
 * Split a snippet into plain and matched runs. The server sends control
 * characters rather than <mark> tags because the text underneath is publisher
 * HTML — this way the highlight is rendered by the page and the post's own
 * markup never reaches the DOM.
 */
export function highlight(snippet: string): { text: string; hit: boolean }[] {
  const out: { text: string; hit: boolean }[] = [];
  for (const chunk of snippet.split(OPEN)) {
    const [hit, ...rest] = chunk.split(CLOSE);
    if (rest.length) {
      if (hit) out.push({ text: hit, hit: true });
      const tail = rest.join(CLOSE);
      if (tail) out.push({ text: tail, hit: false });
    } else if (hit) {
      out.push({ text: hit, hit: false });
    }
  }
  return out;
}
