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
import { HISTORY_INDEX } from './listmemory';

/** A page by name and address, and `at`, the router's number for its history entry. */
export type Place = { name: string; href: string; at: number };

let leaving: Place | null = null;

const indexHere = (): number | undefined => {
  const at = history.state?.[HISTORY_INDEX];
  return typeof at === 'number' ? at : undefined;
};

/**
 * A page's name from its title: "Mid Century · @christie · thicket" is
 * "Mid Century". A search on Explore is still Explore. Null for a page with
 * no title of its own.
 */
export function placeName(title: string): string | null {
  if (!title.endsWith(' · thicket')) return null;
  const parts = title.slice(0, -' · thicket'.length).split(' · ').filter(Boolean);
  if (parts.includes('Explore')) return 'Explore';
  return parts[0] ?? null;
}

/** Once, in the root layout: note each page as it is left. */
export function watchLeaving() {
  beforeNavigate(() => {
    const name = placeName(document.title);
    const at = indexHere();
    leaving = name && at !== undefined ? { name, href: location.pathname + location.search, at } : null;
  });
}

/**
 * From a page's afterNavigate: on arriving by a link, keep the page just left
 * in this history entry, unless `skip` says it isn't somewhere to go back to
 * (another view of this same page, say). Only when it is the step right
 * behind: a navigation that replaced the page left (like signing in) has
 * nothing of it behind to go back to.
 */
export function keepCameFrom(nav: AfterNavigate, skip: (from: URL) => boolean) {
  if (nav.type !== 'link' && nav.type !== 'goto') return;
  const from = leaving;
  const at = indexHere();
  if (!from || !nav.from || at !== from.at + 1 || skip(nav.from.url)) return;
  replaceState('', { ...page.state, cameFrom: { name: from.name, href: from.href, at } });
}

/**
 * The page this one was reached from, if going back one step returns to it.
 * The reader opening over a page carries the note into its own entry; from
 * there, one step back is this page, not the one named.
 */
export function cameFrom(): Place | undefined {
  const c = page.state.cameFrom;
  return c && indexHere() === c.at ? c : undefined;
}
