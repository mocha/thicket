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
