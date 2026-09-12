/**
 * The "Add a feed" sheet is app-wide: the nav opens it over whatever page you
 * are on, empty rivers open it, /add (the share target) opens it prefilled.
 * One store, one sheet mounted in the layout.
 */
export type AddFeedOpts = { url?: string; collectionIds?: number[]; via?: string; autoSubmit?: boolean };

export const addFeed = $state<{ open: boolean; opts: AddFeedOpts; nonce: number }>({ open: false, opts: {}, nonce: 0 });

export function openAddFeed(opts: AddFeedOpts = {}) {
  addFeed.opts = opts;
  addFeed.nonce++;
  addFeed.open = true;
}
export function closeAddFeed() {
  addFeed.open = false;
}
