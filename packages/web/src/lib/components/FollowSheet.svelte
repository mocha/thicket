<script lang="ts">
  /**
   * The Follow sheet: where the Follow button sends you to choose which of
   * your collections hold a feed. Built like the Add a feed sheet — same
   * Sheet, same collection list with its filter and seven-row scroll — so the
   * two read as one way of filing a feed. The difference is timing: here each
   * tick saves at once (a "Saved" note by the heading confirms it), so closing
   * is never a cancel and Done just closes.
   * The title follows the state: "Follow Core77" until the first tick, then
   * "Following Core77". Unfollow takes it out of every collection at once,
   * worth one click when a feed sits in five.
   */
  import { api } from '$lib/api';
  import { loadCollections } from '$lib/collections.svelte';
  import { showToast } from '$lib/toast.svelte';
  import Sheet from './Sheet.svelte';
  import CollectionCheckList from './CollectionCheckList.svelte';
  import SavedNote from './SavedNote.svelte';
  import Button from './Button.svelte';

  let { feedId, ids = $bindable(), name, onchange, onclose }: {
    feedId: number; ids: number[]; name: string; onchange?: (ids: number[]) => void; onclose: () => void;
  } = $props();

  let dialog = $state<HTMLDialogElement | null>(null);
  let saved = $state(false);
  const following = $derived(ids.length > 0);

  $effect(() => { dialog?.showModal(); });

  async function unfollow() {
    const removed = await api.unfollow(feedId);
    const prev = ids;
    ids = [];
    onchange?.(ids);
    dialog?.close();
    api.event('feed_unfollowed', { feedId, via: 'follow_button' });
    void loadCollections(true);
    showToast(`Unfollowed ${name}`, {
      label: 'Undo',
      run: async () => { const r = await api.restore(feedId, removed.collectionIds.length ? removed.collectionIds : prev); ids = r.collectionIds; onchange?.(ids); void loadCollections(true); }
    });
  }
</script>

<Sheet title={following ? `Following ${name}` : `Follow ${name}`} bind:dialog {onclose}>
  <div class="eyebrow"><span>Put it in a collection</span><SavedNote show={saved} /></div>
  <CollectionCheckList {feedId} bind:ids bind:saved {name} {onchange} />
  {#snippet footer()}
    <div class="actions">
      {#if following}<Button variant="danger" size="lg" onclick={unfollow}>Unfollow</Button>{/if}
      <button type="button" class="sheet-action" onclick={() => dialog?.close()}>Done</button>
    </div>
  {/snippet}
</Sheet>

<style>
  .eyebrow { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); font-size: calc(var(--text-xs) * var(--size-app)); text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-3); margin-top: var(--space-1); }
  .actions { display: flex; gap: var(--space-2); align-items: stretch; }
  .actions :global(.sheet-action) { flex: 1; }
</style>
