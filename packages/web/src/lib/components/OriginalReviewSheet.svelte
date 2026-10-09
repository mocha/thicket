<script lang="ts">
  /**
   * Updates from the original (issue #52): what the collection I copied has
   * that my copy doesn't, to take or pass on. New feeds come first, ticked;
   * the ones I passed on before come after, unticked, in case I've changed my
   * mind. Finishing adds what's ticked to the top of my copy and remembers the
   * rest as passed on, so they aren't counted as new again.
   *
   * Each row carries the same follow control as everywhere else, so it shows
   * whether I already follow a feed somewhere ("In Tech News"), and a feed can
   * be filed somewhere else entirely from here, without taking it into this copy.
   */
  import { api, collectionsApi, type OriginalUpdates } from '$lib/api';
  import { hostOf } from '$lib/time';
  import { feedListName } from '$lib/feedname';
  import Sheet from './Sheet.svelte';
  import SourceIcon from './SourceIcon.svelte';
  import FollowControl from './FollowControl.svelte';

  let { collectionId, name, onclose, ondone }: {
    /** My copy, and what it's called. */
    collectionId: number; name: string; onclose: () => void; ondone: (r: { added: number; ignored: number }) => void;
  } = $props();

  let dialog = $state<HTMLDialogElement | null>(null);
  let data = $state<OriginalUpdates | null>(null);
  let failed = $state<string | null>(null);
  let ticked = $state<number[]>([]);
  let busy = $state(false);

  const fresh = $derived(data?.feeds.filter((f) => !f.ignored) ?? []);
  const passed = $derived(data?.feeds.filter((f) => f.ignored) ?? []);

  $effect(() => { dialog?.showModal(); });

  $effect(() => {
    collectionsApi.original(collectionId).then((d) => {
      data = d;
      ticked = d.feeds.filter((f) => !f.ignored).map((f) => f.id);
      api.event('original_review_opened', { collectionId, fresh: ticked.length, passed: d.feeds.length - ticked.length });
    }).catch((e) => (failed = e instanceof Error ? e.message : String(e)));
  });

  function toggle(id: number) {
    ticked = ticked.includes(id) ? ticked.filter((x) => x !== id) : [...ticked, id];
  }

  async function finish() {
    if (!data || busy) return;
    busy = true;
    try {
      const ignore = data.feeds.map((f) => f.id).filter((id) => !ticked.includes(id));
      const r = await collectionsApi.reviewOriginal(collectionId, ticked, ignore);
      api.event('original_reviewed', { collectionId, ...r });
      ondone(r);
      dialog?.close();
    } catch (e) {
      failed = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }
</script>

{#snippet row(f: OriginalUpdates['feeds'][number])}
  <li>
    <label>
      <input type="checkbox" checked={ticked.includes(f.id)} onchange={() => toggle(f.id)} disabled={busy} />
      <SourceIcon feedId={f.id} hasIcon={f.hasIcon} name={f.title ?? hostOf(f.url)} size={28} />
      <span class="which"><strong>{feedListName(f)}</strong><span>{hostOf(f.siteUrl ?? f.url)}</span></span>
    </label>
    <FollowControl feedId={f.id} bind:ids={f.myCollectionIds} name={f.title ?? hostOf(f.url)} compact />
  </li>
{/snippet}

<Sheet title="Updates from the original" bind:dialog {onclose}>
  {#if failed}
    <p class="note bad" role="alert">{failed}</p>
  {:else if !data}
    <p class="note">Loading…</p>
  {:else if !data.original}
    <p class="note">The collection this was copied from isn’t shared with you any more, so there’s nothing to compare it to.</p>
  {:else if data.feeds.length === 0}
    <p class="note">Your copy has every feed in {data.original.name}.</p>
  {:else}
    {#if fresh.length}
      <p class="note">{fresh.length === 1 ? 'A feed' : `${fresh.length} feeds`} in {data.original.name} by @{data.original.owner.handle} that your copy doesn’t have. Untick any you don’t want.</p>
      <ul class="feeds">{#each fresh as f (f.id)}{@render row(f)}{/each}</ul>
    {:else}
      <p class="note">Nothing new in {data.original.name} since you last looked.</p>
    {/if}
    {#if passed.length}
      <div class="eyebrow">You passed on these before</div>
      <ul class="feeds">{#each passed as f (f.id)}{@render row(f)}{/each}</ul>
    {/if}
  {/if}
  {#snippet footer()}
    {#if data?.original && data.feeds.length}
      <button class="sheet-action" onclick={finish} disabled={busy}>
        {busy ? 'Saving…' : ticked.length ? `Add ${ticked.length === 1 ? '1 feed' : `${ticked.length} feeds`} to ${name}` : 'Done'}
      </button>
    {/if}
  {/snippet}
</Sheet>

<style>
  .note { margin: 0; color: var(--text-2); font-size: calc(var(--text-sm) * var(--size-app)); }
  .bad { color: var(--danger); }
  .eyebrow { margin-top: var(--space-2); font-size: calc(var(--text-sm) * var(--size-app)); font-weight: 600; color: var(--text-2); }
  .feeds { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: var(--space-2); }
  .feeds li { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-2) var(--space-3); border-radius: var(--radius-sm); background: var(--bg); border: 1px solid var(--line); }
  label { flex: 1; min-width: 0; display: flex; align-items: center; gap: var(--space-3); cursor: pointer; }
  input { width: 20px; height: 20px; margin: 0; flex: none; accent-color: var(--accent); }
  .which { display: flex; flex-direction: column; min-width: 0; font-size: calc(var(--text-sm) * var(--size-app)); }
  .which strong, .which span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .which span { color: var(--text-2); }
</style>
