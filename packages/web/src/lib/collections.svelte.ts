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

/** Named collections (everything except the root "Unsorted" bucket), for pickers and pills. */
export function namedCollections(): Collection[] {
  return collectionStore.list.filter((c) => c.parentId !== null);
}
