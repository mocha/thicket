/**
 * A signed-out visitor who wants someone's collection goes off to sign up or
 * log in and comes back. The way back carries `?copy` on the collection's
 * address, so the collection page knows to copy it the moment they return,
 * and the sign-up and log-in pages can say what they're signing up to get.
 */

export const COPY_PARAM = 'copy';

/**
 * Between the collection page and the welcome tour: whether the tour is open,
 * and the name of a collection that was just copied on arrival. The tour
 * opens over the new copy and says so at the top; with the tour open, the
 * page skips its own "Copied" note.
 */
export const welcome = $state<{ open: boolean; copied: string | null }>({ open: false, copied: null });

/** Where Sign up or Log in should return to, so the collection gets copied on arrival. */
export function copyNext(handle: string, slug: string, from: string): string {
  return `/@${encodeURIComponent(handle)}/collections/${encodeURIComponent(slug)}?${COPY_PARAM}=${encodeURIComponent(from)}`;
}

/** The collection a `next` address will copy on arrival, if it's one of those. */
export function copyTarget(next: string | null): { handle: string; slug: string } | null {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return null;
  const url = new URL(next, 'http://x');
  if (!url.searchParams.has(COPY_PARAM)) return null;
  const m = url.pathname.match(/^\/@([^/]+)\/collections\/([^/]+)\/?$/);
  return m ? { handle: decodeURIComponent(m[1]), slug: decodeURIComponent(m[2]) } : null;
}
