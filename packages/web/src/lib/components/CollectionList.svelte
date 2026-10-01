<script lang="ts">
  /**
   * The list of your collections with a box to tick beside each, used wherever
   * you choose where a feed goes: the Add a feed sheet, the Follow sheet, and
   * a feed's settings page. It only shows and reports; what a tick means (save
   * now, or wait for Follow) is up to the caller's `ontoggle`.
   *
   * With a lot of collections the list becomes a scroll of about seven rows,
   * and a filter appears above it — only once there are enough to bother, so
   * short lists stay clean. It narrows to names that contain what you type,
   * ignoring case. The list is alphabetical, so a ticked row is often below
   * the fold: on arrival the first ticked row is centered in view.
   *
   * The last row, pinned inside the list's border so it shows even when the
   * rows scroll, starts a new collection: it reads as one more place the feed
   * can go. Tapping it turns the row into a name box; Enter creates it and hands
   * it to `oncreated`, and Escape or leaving it empty puts the row back. If a
   * filter found nothing, what you typed there becomes the suggested name.
   * Below the list, `hint` explains where the feed will go.
   * Mount it fresh for each use (a `{#key}` block) so the filter starts empty.
   */
  import { tick } from 'svelte';
  import { api, collectionsApi } from '$lib/api';
  import { collectionStore, loadCollections, namedCollections } from '$lib/collections.svelte';
  import { showToast } from '$lib/toast.svelte';
  import Button from './Button.svelte';
  import Field from './Field.svelte';
  import Input from './Input.svelte';

  let { ids, ontoggle, oncreated, hint, via, disabled = false, flash = new Set() }: {
    ids: number[];
    ontoggle: (id: number) => void;
    /** A new collection was just made from the row at the bottom. */
    oncreated: (id: number) => void;
    hint?: string;
    /** Where this list is, for the analytics event on create. */
    via: string;
    disabled?: boolean;
    /** Collection ids whose count just went up, to pop the number. */
    flash?: Set<number>;
  } = $props();

  let list = $state<HTMLElement | null>(null);
  let filter = $state('');
  let newName = $state('');
  let creating = $state(false);
  /** The new-collection row is showing its name box. */
  let naming = $state(false);
  let nameEl = $state<HTMLInputElement | null>(null);

  const showFilter = $derived(namedCollections().length > 6);
  const visible = $derived.by(() => {
    const q = filter.trim().toLowerCase();
    return q ? namedCollections().filter((c) => c.name.toLowerCase().includes(q)) : namedCollections();
  });

  $effect(() => {
    void loadCollections().then(async () => {
      await tick();
      list?.querySelector('input:checked')?.closest('li')?.scrollIntoView({ block: 'center' });
    });
  });

  async function startNaming() {
    newName = visible.length ? '' : filter.trim();
    naming = true;
    await tick();
    nameEl?.focus();
  }
  function stopNaming() {
    naming = false;
    newName = '';
  }

  async function create() {
    const name = newName.trim();
    if (!name || creating) return;
    creating = true;
    try {
      const c = await collectionsApi.create(name);
      await loadCollections(true);
      newName = '';
      naming = false;
      filter = '';
      api.event('collection_created', { collectionId: c.id, via });
      oncreated(c.id);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    } finally {
      creating = false;
    }
  }
</script>

{#if showFilter}
  <Field label="Filter collections" hideLabel>
    {#snippet children({ id })}
      <Input
        {id}
        variant="search"
        size="sm"
        inset
        bind:value={filter}
        placeholder="Filter collections…"
        {disabled}
        onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter') e.preventDefault(); else if (e.key === 'Escape' && filter) { e.preventDefault(); e.stopPropagation(); filter = ''; } }}
      />
    {/snippet}
  </Field>
{/if}
<div class="frame">
  <div class="scroll" bind:this={list}>
    <ul class="checks">
      {#each visible as c (c.id)}
        <li>
          <label>
            <input type="checkbox" checked={ids.includes(c.id)} onchange={() => ontoggle(c.id)} {disabled} />
            <span class="name">{c.name}</span>
            <span class="count" class:flash={flash.has(c.id)}>{c.feedCount}</span>
          </label>
        </li>
      {/each}
    </ul>
    {#if filter.trim() && !visible.length}
      <p class="nomatch">No collections match “{filter.trim()}”</p>
    {/if}
  </div>
  {#if collectionStore.loaded}
    <div class="new" class:alone={!visible.length && !filter.trim()}>
      {#if naming}
        <span class="plus" aria-hidden="true">+</span>
        <Field label="New collection name" hideLabel class="grow">
          {#snippet children({ id })}
            <Input
              {id}
              bind:value={newName}
              bind:element={nameEl}
              placeholder="Name it…"
              disabled={creating}
              onblur={() => { if (!newName.trim() && !creating) stopNaming(); }}
              onkeydown={(e: KeyboardEvent) => {
                if (e.key === 'Enter') { e.preventDefault(); void create(); }
                else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); stopNaming(); }
              }}
            >
              {#snippet trailing()}
                <Button variant="primary" size="sm" onclick={create} disabled={creating || !newName.trim()}>Create</Button>
              {/snippet}
            </Input>
          {/snippet}
        </Field>
      {:else}
        <button type="button" class="start" onclick={startNaming} {disabled}>
          <span class="plus" aria-hidden="true">+</span>
          <span class="name">Add a new collection</span>
        </button>
      {/if}
    </div>
  {/if}
</div>
{#if hint && collectionStore.loaded}<p class="hint">{hint}</p>{/if}

<style>
  /* The border holds both the scrolling rows and the pinned new-collection row. */
  .frame { display: flex; flex-direction: column; min-height: 0; flex: 0 1 auto; border: 1px solid var(--line); border-radius: var(--radius-sm); overflow: hidden; }
  .scroll { overflow-y: auto; min-height: 0; flex: 0 1 auto; max-height: 38vh; padding: 0 var(--space-3); }
  /* Desktop cap. Must come after the base .scroll rule above: same specificity,
     so source order decides, and the list should top out at ~7 rows and scroll,
     not grow to a third of a tall screen. 320px cuts the seventh row through
     its name, so a half-shown name says "there's more"; a cut through its
     blank top margin read as a gap. */
  @media (min-width: 700px) { .scroll { max-height: 320px; } }
  .checks { list-style: none; margin: 0; padding: 0; }
  /* Dividers sit under each row except the last; the pinned new-collection row
     draws its own line on top. So a row half-hidden by the scroll never adds a
     second line above that one, and a fully scrolled list shows just one. */
  .checks label { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--space-1); border-bottom: 1px solid var(--line); cursor: pointer; }
  .checks li:last-child label { border-bottom: 0; }
  /* No browser margin, so the box and the + in the last row share one column. */
  .checks input { width: 20px; height: 20px; margin: 0; flex: none; accent-color: var(--accent); }
  .name { flex: 1; font-weight: 500; }
  .count { font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); transition: color 300ms; }
  .count.flash { color: var(--accent); font-weight: 700; animation: pop 1.2s ease-out; }
  @keyframes pop { 0% { transform: scale(1.4); } 30% { transform: scale(1); } 100% { transform: scale(1); } }
  .nomatch { margin: 0; padding: var(--space-3) var(--space-2); color: var(--text-2); font-size: calc(var(--text-sm) * var(--size-app)); }
  .hint { margin: calc(-1 * var(--space-1)) 0 0; font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); }
  /* Lined up with the rows above: the + sits where a checkbox would. */
  .new { display: flex; align-items: center; gap: var(--space-3); margin: 0 var(--space-3); padding: var(--space-2) var(--space-1); min-height: 52px; border-top: 1px solid var(--line); }
  .new.alone { border-top: 0; }
  .new :global(.grow) { flex: 1; min-width: 0; }
  .start { display: flex; align-items: center; gap: var(--space-3); flex: 1; margin: 0; padding: var(--space-1) 0; border: 0; background: none; font: inherit; color: var(--accent); text-align: left; }
  .start .name { font-weight: 600; }
  .start:hover .name { text-decoration: underline; text-underline-offset: 0.2em; }
  .plus { width: 20px; text-align: center; color: var(--accent); font-size: calc(var(--text-xl) * var(--size-app)); line-height: 1; font-weight: 600; flex: none; }
</style>
