/**
 * Writing an @mention in a note (issue #184): what the note editor's
 * typeahead needs.
 *
 * Who can be suggested: only the people I follow, and of those only the ones
 * whose profiles are public, which is exactly my Following list
 * (GET /api/profiles/:me/following). That list is fetched once, the first time
 * I type an `@`, and kept for the rest of the visit; following someone new
 * shows up after a reload. Anyone else can still be mentioned by typing their
 * handle out.
 *
 * A suggestion matches on the handle or on the display name, so `@Chris` finds
 * "Christie Smith" (@csmith). What goes into the note is always the handle.
 */
import { profilesApi, type PublicUser } from './api';

let cache: { handle: string; list: Promise<PublicUser[]> } | null = null;

/** The people I follow who can be suggested. Fetched once per visit; an error just means no suggestions. */
export function mentionablePeople(myHandle: string): Promise<PublicUser[]> {
  if (cache?.handle !== myHandle) {
    const list = profilesApi.following(myHandle).then((r) => r.users).catch(() => {
      cache = null; // try again next time
      return [];
    });
    cache = { handle: myHandle, list };
  }
  return cache.list;
}

/**
 * The mention being typed at the caret, if any: where its `@` is and what has
 * been typed after it. The same rule for where a mention may start as the
 * notes themselves use (lib/markdown.ts), so an email address doesn't open
 * suggestions.
 */
export function mentionAt(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const m = /(?:^|[^A-Za-z0-9_@/.-])@([^\s@]{0,30})$/.exec(before);
  if (!m) return null;
  return { start: caret - m[1].length - 1, query: m[1] };
}

/** Best first: handle starts with it, then a word of the name does, then either merely contains it. At most `limit`. */
export function rankPeople(people: PublicUser[], query: string, limit = 6): PublicUser[] {
  const q = query.toLowerCase();
  const score = (p: PublicUser) => {
    const h = p.handle.toLowerCase();
    const n = (p.displayName ?? '').toLowerCase();
    if (!q) return 3;
    if (h.startsWith(q)) return 0;
    if (n.startsWith(q) || n.split(/\s+/).some((w) => w.startsWith(q))) return 1;
    if (h.includes(q) || n.includes(q)) return 2;
    return -1;
  };
  return people
    .map((p) => ({ p, s: score(p) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => a.s - b.s || (a.p.displayName ?? a.p.handle).localeCompare(b.p.displayName ?? b.p.handle))
    .slice(0, limit)
    .map((x) => x.p);
}
