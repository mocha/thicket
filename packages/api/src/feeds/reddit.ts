/**
 * Reddit serves an Atom feed for almost any listing by appending `.rss`,
 * but never advertises it. Pure URL rewriting, no fetch:
 *
 *   reddit.com/r/Sub                  → five feeds (hot, new, rising, top,
 *                                       controversial); the add sheet asks
 *                                       which. New is what a chronological
 *                                       reader usually wants, so it is first.
 *   reddit.com/r/Sub/new (etc.)       → that one listing's feed
 *   reddit.com/r/Sub/comments/id/…    → the thread's comments as a feed
 *   reddit.com/user/name              → what that account posts
 *   reddit.com/user/name/m/multi      → a multireddit
 *   reddit.com/…/.rss or .json        → already a feed address
 *
 * old., np., m., i. and bare reddit.com all normalize to www.reddit.com.
 * Reddit rate-limits unauthenticated clients per IP (roughly one request
 * every couple of seconds; a burst gets 429s), which is a scheduler concern,
 * not a discovery one: the scheduler does not yet honor `Retry-After` or
 * space requests to one host over time.
 */
import type { Candidate } from "./discover.js";

const HOST = /^(www\.|old\.|new\.|np\.|m\.|i\.)?reddit\.com$/i;
const SORTS: { path: string; label: string }[] = [
  { path: "new", label: "New" },
  { path: "hot", label: "Hot" },
  { path: "rising", label: "Rising" },
  { path: "top", label: "Top" },
  { path: "controversial", label: "Controversial" },
];
const SORT_SET = new Set(SORTS.map((s) => s.path));

export type RedditResolution = { feedUrl: string } | { pageUrl: string; candidates: Candidate[] };

export function isRedditUrl(input: string): boolean {
  try { return HOST.test(new URL(input).hostname); } catch { return false; }
}

export function resolveReddit(input: string): RedditResolution | null {
  let u: URL;
  try { u = new URL(input); } catch { return null; }
  if (!HOST.test(u.hostname)) return null;
  const seg = u.pathname.split("/").filter(Boolean);
  const base = "https://www.reddit.com";
  const feed = (path: string) => `${base}/${path}/.rss`;

  // Already a feed address, in either of Reddit's spellings.
  if (seg.length && /^\.(rss|json)$/i.test(seg[seg.length - 1])) return { feedUrl: `${base}/${seg.slice(0, -1).join("/")}/.rss` };
  if (seg.length && /\.rss$/i.test(seg[seg.length - 1])) return { feedUrl: `${base}/${seg.join("/")}` };

  if (seg[0] === "r" && seg[1]) {
    const sub = seg[1];
    // A thread: its comments are the feed.
    if (seg[2] === "comments" && seg[3]) return { feedUrl: feed(`r/${sub}/comments/${seg[3]}`) };
    // One listing: hot, new, …
    if (seg[2] && SORT_SET.has(seg[2].toLowerCase())) return { feedUrl: feed(`r/${sub}/${seg[2].toLowerCase()}`) };
    // The subreddit itself: offer each listing.
    if (!seg[2]) {
      return {
        pageUrl: `${base}/r/${sub}/`,
        candidates: SORTS.map((s) => ({ url: feed(`r/${sub}/${s.path}`), title: `r/${sub} · ${s.label}`, kind: "atom" })),
      };
    }
    return null;
  }
  if ((seg[0] === "user" || seg[0] === "u") && seg[1]) {
    if (seg[2] === "m" && seg[3]) return { feedUrl: feed(`user/${seg[1]}/m/${seg[3]}`) };
    return { feedUrl: feed(`user/${seg[1]}`) };
  }
  return null; // the front page and everything else: ordinary discovery
}
