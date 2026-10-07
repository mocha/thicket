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
 *
 * The installed app (added to the Dock or home screen) has no browser
 * toolbar. Chrome and Edge give it their own Back button, asked for in the
 * manifest; Safari and iPhone don't, so there the app shows its own Back on
 * every page, whenever there is a step in the app to go back to.
 */
import type { AfterNavigate } from '@sveltejs/kit';
import { afterNavigate, beforeNavigate, replaceState } from '$app/navigation';
import { page } from '$app/state';

export type Place = { name: string; href: string };

let leaving: Place | null = null;

/** The router's number for each history entry; one more for each step in. */
const HISTORY_INDEX = 'sveltekit:history';
let first: number | null = null;

/**
 * Whether the app shows its own Back: in an installed app with no browser
 * toolbar, with a step behind this page that this visit made. `owned` counts
 * Back links the page draws itself; at the top of a page the app's Back
 * steps aside for them rather than stacking two.
 */
export const appBack = $state({ installed: false, behind: false, owned: 0 });

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

/**
 * Once, in the root layout: note each page as it is left, and whether there
 * is a step behind this one. The first page of a visit (or a reload) has none
 * we can count on, even if the browser kept some from before.
 */
export function watchLeaving() {
  // iPhone's home-screen apps say so their own way.
  appBack.installed = matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
  beforeNavigate(() => {
    const name = placeName(document.title);
    leaving = name ? { name, href: location.pathname + location.search } : null;
  });
  afterNavigate(() => {
    const at = history.state?.[HISTORY_INDEX];
    if (typeof at !== 'number') return;
    first ??= at;
    appBack.behind = at > first;
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
