/**
 * Saving and noting a post, the same wherever you meet it. A note is part of a
 * bookmark (issue #84): writing one saves the post, and removing the bookmark
 * removes the note, so both messages say so.
 */
import type { Note, RiverItem } from '$lib/api';
import { api, bookmarksApi } from '$lib/api';
import { showToast } from '$lib/toast.svelte';

/** What to say once a note is saved. Call it before the item takes the new note. */
export function noteToast(item: { myNote: Note | null; bookmarkId: number | null }): string {
  if (item.myNote) return 'Note updated';
  return item.bookmarkId ? 'Note saved' : 'Note saved to Bookmarks';
}

/**
 * Remove my bookmark of a post, and its note with it. The item updates at once;
 * the toast offers Undo, which puts both back exactly as they were.
 */
export async function unsaveItem(item: RiverItem, via: string): Promise<void> {
  const id = item.bookmarkId;
  if (!id) return;
  const note = item.myNote;
  item.bookmarkId = null;
  item.myNote = null;
  try {
    const removed = await bookmarksApi.remove(id);
    api.event('bookmark_removed', { itemId: item.id, via, hadNote: !!note });
    showToast(note ? 'Removed bookmark and note' : 'Removed bookmark', {
      label: 'Undo',
      run: async () => {
        const back = await bookmarksApi.restore(removed);
        item.bookmarkId = back.id;
        item.myNote = note ? { ...note, id: back.id } : null;
      }
    });
  } catch (err) {
    // The remove was optimistic; put everything back if the request failed.
    item.bookmarkId = id;
    item.myNote = note;
    showToast(err instanceof Error ? err.message : String(err));
  }
}

/**
 * Remove one of my bookmarks from a list of them, its note with it: My
 * Bookmarks, and my own profile (issue #170). `drop` takes the card out at
 * once. `putBack` returns it, with the id it now has: after Undo that is a new
 * one, and after a failed remove it is the same one.
 */
export async function removeBookmark(
  b: { id: number; note: Note | null },
  via: string,
  list: { drop: () => void; putBack: (id: number) => void }
): Promise<void> {
  list.drop();
  try {
    const removed = await bookmarksApi.remove(b.id);
    api.event('bookmark_removed', { bookmarkId: b.id, via, hadNote: !!b.note });
    showToast(b.note ? 'Removed bookmark and note' : 'Removed bookmark', {
      label: 'Undo',
      run: async () => list.putBack((await bookmarksApi.restore(removed)).id)
    });
  } catch (err) {
    list.putBack(b.id);
    showToast(err instanceof Error ? err.message : String(err));
  }
}

/**
 * The list now, with one removed bookmark back where it was and under the id
 * it now has. Anything else removed meanwhile stays gone, and anything loaded
 * meanwhile stays, at the end.
 */
export function withBookmarkBack<T extends { id: number; note: Note | null }>(now: T[], before: T[], oldId: number, newId: number): T[] {
  const byId = new Map(now.map((x) => [x.id, x]));
  const out = before.flatMap((x) => {
    if (x.id === oldId) return [{ ...x, id: newId, note: x.note && { ...x.note, id: newId } }];
    const kept = byId.get(x.id);
    return kept ? [kept] : [];
  });
  const placed = new Set(out.map((x) => x.id));
  return [...out, ...now.filter((x) => !placed.has(x.id))];
}
