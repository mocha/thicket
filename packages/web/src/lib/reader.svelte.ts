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

export const reader = $state<{ item: RiverItem | null }>({ item: null });

/** Whether a click on a post should open it here rather than on its own site. Visitors always click out. */
export function readsInline(): boolean {
  return display.reading === 'inline' && !!session.user;
}

export function openReader(item: RiverItem) {
  reader.item = item;
  pushState('', { ...page.state, reader: item.id });
}

/** Called by the reader itself when the history entry above it is gone. */
export function readerClosed() {
  reader.item = null;
}
