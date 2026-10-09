<script lang="ts">
  /**
   * The Follow sheet: where the Follow button sends you to choose which of
   * your collections hold a feed. Built like the Add a feed sheet — same
   * Sheet, same collection list with its filter and seven-row scroll — and
   * it works in one of two ways, fixed for as long as the sheet is open:
   *
   * - Not following yet: exactly like Add a feed. Starting to follow
   *   something is one decision, so you pick collections, then press Follow;
   *   closing without it is a true cancel. Pick nothing and it goes in your
   *   default collection, as the line under the list says.
   * - Already following: each tick saves at once, since moving a feed
   *   between collections is a run of small, reversible tweaks. A "Saved"
   *   note by the heading confirms each one, and Done just closes. Unfollow
   *   takes it out of every collection at once, worth one click when a feed
   *   sits in five. It is a red text link under Done, not a button beside
   *   it: side by side they read as two equal ways to close the sheet.
   *
   * So "Follow" means the same thing in both sheets: press it to start.
   */
  import { api, collectionsApi } from '$lib/api';
  import { collectionStore, loadCollections, placeName, whereItGoes } from '$lib/collections.svelte';
  import { showToast } from '$lib/toast.svelte';
  import Sheet from './Sheet.svelte';
  import CollectionList from './CollectionList.svelte';
  import CollectionCheckList from './CollectionCheckList.svelte';
  import SavedNote from './SavedNote.svelte';
  import Button from './Button.svelte';

  let { feedId, ids = $bindable(), name, onchange, onclose }: {
    feedId: number; ids: number[]; name: string; onchange?: (ids: number[]) => void; onclose: () => void;
  } = $props();

  let dialog = $state<HTMLDialogElement | null>(null);
  /** Which way the sheet works is decided when it opens and stays put, so it never changes under you mid-task. */
  // svelte-ignore state_referenced_locally
  const adding = ids.length === 0;
  /** Adding: the boxes you've ticked, not saved until Follow. */
  let picked = $state<number[]>([]);
  let busy = $state(false);
  let saved = $state(false);
  const following = $derived(ids.length > 0);

  $effect(() => { dialog?.showModal(); });

  function pick(id: number) {
    picked = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id];
  }

  /** Adding: file it where you picked, or in your default collection if you picked nothing. */
  async function follow() {
    if (busy) return;
    busy = true;
    try {
      const res = picked.length ? await collectionsApi.setFeedCollections(feedId, picked) : await api.follow(feedId);
      ids = res.collectionIds;
      onchange?.(ids);
      api.event('feed_followed', { feedId, collectionIds: ids, via: 'follow_sheet' });
      await loadCollections(true);
      const where = placeName(ids);
      showToast(where ? `Following ${name} in ${where}` : `Following ${name}`, {
        label: 'Undo',
        run: async () => { await collectionsApi.setFeedCollections(feedId, []); ids = []; onchange?.(ids); void loadCollections(true); }
      });
      dialog?.close();
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      showToast(`Couldn’t follow ${name}: ${reason}`);
      api.event('feed_follow_failed', { feedId, collectionIds: picked, reason });
    } finally {
      busy = false;
    }
  }

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

<!-- The line under the title says what the list is for: where a new follow will go (updating as you tick), or the rule for one you already follow. -->
{#snippet lede()}
  {#if adding}{#if collectionStore.loaded}<p>{whereItGoes(picked)}</p>{/if}
  {:else}<p>Every feed you follow lives in at least one collection.</p><SavedNote show={saved} />{/if}
{/snippet}

<Sheet title={adding || !following ? `Follow ${name}` : `Following ${name}`} lede={adding && !collectionStore.loaded ? undefined : lede} dismiss={adding ? undefined : false} bind:dialog {onclose}>
  {#if adding}
    <CollectionList ids={picked} via="follow_sheet" disabled={busy} ontoggle={pick} oncreated={(id) => (picked = [...picked, id])} />
  {:else}
    <CollectionCheckList {feedId} bind:ids bind:saved {name} {onchange} showHint={false} />
  {/if}
  {#snippet footer()}
    {#if adding}
      <button type="button" class="sheet-action" onclick={follow} disabled={busy}>{busy ? 'Following…' : 'Follow'}</button>
    {:else}
      <button type="button" class="sheet-action" onclick={() => dialog?.close()}>Done</button>
      {#if following}<Button variant="danger" link onclick={unfollow}>Unfollow</Button>{/if}
    {/if}
  {/snippet}
</Sheet>
