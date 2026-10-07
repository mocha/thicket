/**
 * The way back from a page to the one you came to it from, by name.
 *
 * Every page is noted as it is left: its name (from its title) and its
 * address. A page that offers a way back keeps that note in its own history
 * entry when it is arrived at by a link, so the note survives the reader
 * opening and closing over it, and Back and Forward through it. Following the
 * way back then steps back in history rather than opening the page afresh: the
 * list memory restores where you were (search, filters, scroll), and Back
 * afterwards doesn't land on this page again.
 *
 * Arriving any other way (a shared link, a new tab, a reload) there is nothing
 * behind to name, and the page falls back to a plain link.
 */
import type { AfterNavigate } from '@sveltejs/kit';
import { beforeNavigate, replaceState } from '$app/navigation';
import { page } from '$app/state';

export type Place = { name: string; href: string };

let leaving: Place | null = null;

/**
 * A page's name from its title: "Mid Century · @christie · thicket" is
 * "Mid Century". A search on Explore is still Explore. Null for a page with
 * no title of its own.
 */
export function placeName(title: string): string | null {
  const parts = title.split(' · ').filter((p) => p && p !== 'thicket');
  if (parts.includes('Explore')) return 'Explore';
  return parts[0] ?? null;
}

/** Once, in the root layout: note each page as it is left. */
export function watchLeaving() {
  beforeNavigate(() => {
    const name = placeName(document.title);
    leaving = name ? { name, href: location.pathname + location.search } : null;
  });
}

/**
 * From a page's afterNavigate: on arriving by a link, keep the page just left
 * in this history entry, unless `skip` says it isn't somewhere to go back to
 * (another view of this same page, say).
 */
export function keepCameFrom(nav: AfterNavigate, skip: (from: URL) => boolean) {
  if (nav.type !== 'link' && nav.type !== 'goto') return;
  const from = leaving;
  if (!from || !nav.from || skip(nav.from.url)) return;
  replaceState('', { ...page.state, cameFrom: from });
}
