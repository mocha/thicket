/** Shared, lazily loaded list of the user's collections. Anything that changes membership calls refresh(). */
import { api, type Collection } from './api';

export const collectionStore = $state<{ list: Collection[]; rootId: number | null; loaded: boolean }>({ list: [], rootId: null, loaded: false });

export async function loadCollections(force = false) {
  if (collectionStore.loaded && !force) return collectionStore;
  const res = await api.collections();
  collectionStore.list = res.collections;
  collectionStore.rootId = res.rootId;
  collectionStore.loaded = true;
  return collectionStore;
}

/** Forget everything. Called when the signed-in user changes, so one person's list never shows under another's name. */
export function resetCollections() {
  collectionStore.list = [];
  collectionStore.rootId = null;
  collectionStore.loaded = false;
}

/** Every real collection. The root row is the tree's parent, never a place to put anything. */
export function namedCollections(): Collection[] {
  return collectionStore.list.filter((c) => c.parentId !== null);
}

/**
 * Where a feed goes when you press Follow without choosing: your oldest
 * collection, which on a new account is the one you were given. The server
 * picks the same one; this is so the UI can say its name out loud.
 */
export function defaultCollection(): Collection | null {
  return namedCollections().reduce<Collection | null>((best, c) => (!best || c.id < best.id ? c : best), null);
}
