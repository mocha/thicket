/**
 * The in-app reader: which post is open, if any. One reader for the whole app,
 * mounted in the root layout; cards ask for it to open. The open state also
 * lives in history (SvelteKit shallow routing), so the back button and the
 * close button do the same thing and a reload lands on the list, not the post.
 */
import { pushState } from '$app/navigation';
import { page } from '$app/state';
import type { RiverItem } from './api';
import { display } from './display.svelte';
import { session } from './session.svelte';

export const reader = $state<{ item: RiverItem | null; note: boolean }>({ item: null, note: false });

/** Whether a click on a post should open it here rather than on its own site. Visitors always click out. */
export function readsInline(): boolean {
  return display.reading === 'inline' && !!session.user;
}

/** `note` opens the reader with the note editor already showing (paged cards have no room for it). */
export function openReader(item: RiverItem, opts: { note?: boolean } = {}) {
  reader.item = item;
  reader.note = !!opts.note;
  pushState('', { ...page.state, reader: item.id });
}

/** Called by the reader itself when the history entry above it is gone. */
export function readerClosed() {
  reader.item = null;
}
