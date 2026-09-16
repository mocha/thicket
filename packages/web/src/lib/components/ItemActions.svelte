<script lang="ts">
  /**
   * The two things you can do to a post wherever you meet it: leave a note,
   * save a bookmark. The card and the reader both show these, over the same
   * item object, so pressing one in the reader shows in the card behind it.
   */
  import type { RiverItem } from '$lib/api';
  import { api, bookmarksApi } from '$lib/api';
  import { showToast } from '$lib/toast.svelte';

  let { item, noteOpen = false, onnote, via }: { item: RiverItem; noteOpen?: boolean; onnote: () => void; via: 'card' | 'reader' | 'post' } = $props();
  let saving = $state(false);

  /** Save this post. Post-level, private, one set. Tap again to remove. */
  async function toggleBookmark() {
    if (saving) return;
    saving = true;
    try {
      if (item.bookmarkId) {
        const id = item.bookmarkId;
        item.bookmarkId = null;
        await bookmarksApi.remove(id);
        api.event('bookmark_removed', { itemId: item.id, via });
      } else {
        const b = await bookmarksApi.saveItem(item.id);
        item.bookmarkId = b.id;
        api.event('bookmark_saved', { itemId: item.id, feedId: item.feedId, via });
        showToast('Saved to Bookmarks');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    } finally {
      saving = false;
    }
  }
</script>

<button class="act" class:on={!!item.myNote} onclick={onnote} aria-pressed={!!item.myNote} aria-expanded={noteOpen} aria-label={item.myNote ? 'Edit my note' : 'Add a note'} title={item.myNote ? 'My note' : 'Add a note'}>
  <svg viewBox="0 0 24 24" width="18" height="18" fill={item.myNote ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H10l-5 4v-4H5.5A1.5 1.5 0 0 1 4 14.5z" /></svg>
</button>
<button class="act" class:on={!!item.bookmarkId} onclick={toggleBookmark} aria-pressed={!!item.bookmarkId} aria-label={item.bookmarkId ? 'Remove bookmark' : 'Bookmark this post'} title={item.bookmarkId ? 'Bookmarked' : 'Bookmark'}>
  <svg viewBox="0 0 24 24" width="18" height="18" fill={item.bookmarkId ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 4h12v17l-6-4-6 4z" /></svg>
</button>

<style>
  .act { width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; color: var(--text-3); flex: none; }
  .act:hover { background: var(--surface-2); color: var(--accent); }
  .act.on { color: var(--accent); }
  .act:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
</style>
