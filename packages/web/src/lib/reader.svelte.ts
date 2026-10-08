/**
 * The in-app reader: which post is open, if any. One reader for the whole app,
 * mounted in the root layout; cards ask for it to open.
 *
 * An open post has an address — /feeds/:id/:slug/:item/:itemslug, the post
 * inside its feed — and the address is what the back button walks. Opening from
 * a list pushes that address over the list, so back and the close button do the
 * same thing and the list is still there underneath. Arriving at the address
 * cold there is no list behind, so closing goes to the feed the post came from.
 * Stepping back (or forward) onto a post's address after leaving it, say from
 * its feed's page, opens it again over the list it was read from.
 */
import { goto, pushState, replaceState } from '$app/navigation';
import { page } from '$app/state';
import { feedHref, itemHref, itemsApi, type RiverItem } from './api';
import { display } from './display.svelte';
import { session } from './session.svelte';
import { showToast } from './toast.svelte';

export const reader = $state<{ item: RiverItem | null; note: boolean }>({ item: null, note: false });

/** Where closing goes when there is no list behind the reader. Null = go back. */
let landing: string | null = null;

/** Whether a click on a post should open it here rather than on its own site. Visitors always click out. */
export function readsInline(): boolean {
  return display.reading === 'inline' && !!session.user;
}

/** `note` opens the reader with the note editor already showing (paged cards have no room for it). */
export function openReader(item: RiverItem, opts: { note?: boolean } = {}) {
  reader.item = item;
  reader.note = !!opts.note;
  landing = null;
  pushState(itemHref(item), { ...page.state, reader: item.id });
}

/**
 * Open a post that was arrived at by its own address rather than clicked in a
 * list. The address is already right, so this corrects it in place rather than
 * pushing, and closing lands on the feed instead of walking out of the site.
 */
export function openReaderHere(item: RiverItem) {
  reader.item = item;
  reader.note = false;
  landing = feedHref({ id: item.feedId, slug: item.feedSlug });
  replaceState(itemHref(item), { ...page.state, reader: item.id });
}

/** Close: back to the list we came from, or out to the feed when we came from outside. */
export function closeReader() {
  if (landing) {
    const to = landing;
    landing = null;
    void goto(to);
  } else if (page.state.reader !== undefined) {
    history.back();
  } else {
    readerClosed();
  }
}

/** The post being fetched again to reopen, so the reader asks only once. */
let reopening: number | null = null;

/**
 * Called by the reader when history says a post is open but it no longer has
 * the post in hand: back onto it from its feed's page, or Forward onto it after
 * closing. Fetches it and opens it again, if we are still on that step.
 */
export async function reopenReader(id: number) {
  if (reopening === id) return;
  reopening = id;
  try {
    const got = await itemsApi.get(id);
    if (page.state.reader === id && !reader.item) {
      reader.item = got;
      reader.note = false;
      landing = null;
    }
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    console.error(`Couldn't reopen post ${id}:`, e);
    showToast(`Couldn’t open that post again: ${why}`);
  } finally {
    reopening = null;
  }
}

/** Called by the reader itself when the history entry above it is gone. */
export function readerClosed() {
  reader.item = null;
  landing = null;
}
