<script lang="ts">
  /**
   * The two things you can do to a post wherever you meet it: leave a note,
   * save a bookmark. The card and the reader both show these, over the same
   * item object, so pressing one in the reader shows in the card behind it.
   */
  import type { RiverItem } from '$lib/api';
  import { api, bookmarksApi } from '$lib/api';
  import { showToast } from '$lib/toast.svelte';
  import IconButton from './IconButton.svelte';

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

<IconButton
  icon="note"
  pressed={!!item.myNote}
  aria-expanded={noteOpen}
  onclick={onnote}
  label={item.myNote ? 'Edit my note' : 'Add a note'}
  title={item.myNote ? 'My note' : 'Add a note'}
/>
<IconButton
  icon="bookmark"
  pressed={!!item.bookmarkId}
  onclick={toggleBookmark}
  label={item.bookmarkId ? 'Remove bookmark' : 'Bookmark this post'}
  title={item.bookmarkId ? 'Bookmarked' : 'Bookmark'}
/>
