/**
 * Saying what a search result is made of, in words.
 *
 * A search rank is a number nobody can check. Every row on the results page
 * instead shows the three facts the ranking was built from — how many posts
 * matched, how much of the feed's output that is, and how recently it last
 * happened — so someone who disagrees with the order can see what it thought.
 */

/**
 * The share of a feed's output, phrased the way a person would say it. Ratios
 * read as arithmetic homework ("0.083 of its posts"); "about 1 in 12" is the
 * same fact and needs no decoding. Above two thirds the fraction stops being
 * the interesting part and the words take over.
 */
export function shareOfOutput(matches: number, posts: number): string | null {
  if (matches <= 0 || posts <= 0) return null;
  const r = matches / posts;
  if (r >= 0.9) return 'nearly everything it publishes';
  if (r >= 0.66) return 'most of what it publishes';
  if (r >= 0.5) return 'about half of what it publishes';
  const one = Math.round(posts / matches);
  return `about 1 in ${one} of what it publishes`;
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
