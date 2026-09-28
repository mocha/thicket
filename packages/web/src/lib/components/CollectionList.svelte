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
   * Below the list, `hint` explains where the feed will go, then a box to
   * start a new collection, which is created and handed to `oncreated`.
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
    /** A new collection was just made from the box at the bottom. */
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

  async function create() {
    const name = newName.trim();
    if (!name || creating) return;
    creating = true;
    try {
      const c = await collectionsApi.create(name);
      await loadCollections(true);
      newName = '';
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
    <p class="nomatch">No collections match “{filter.trim()}”. Start one below.</p>
  {/if}
</div>
{#if hint && collectionStore.loaded}<p class="hint">{hint}</p>{/if}
{#if collectionStore.loaded}
  <div class="new">
    <span class="plus" aria-hidden="true">+</span>
    <Field label="New collection name" hideLabel class="grow">
      {#snippet children({ id })}
        <Input
          {id}
          variant="create"
          bind:value={newName}
          placeholder="Start a new collection…"
          disabled={creating}
          onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); void create(); } }}
        >
          {#snippet trailing()}
            <Button variant="primary" onclick={create} disabled={creating || !newName.trim()}>Create</Button>
          {/snippet}
        </Input>
      {/snippet}
    </Field>
  </div>
{/if}

<style>
  .scroll { overflow-y: auto; min-height: 0; flex: 0 1 auto; max-height: 38vh; border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 0 var(--space-3); }
  /* Desktop cap. Must come after the base .scroll rule above: same specificity,
     so source order decides, and the list should top out at ~7 rows and scroll,
     not grow to a third of a tall screen. */
  @media (min-width: 700px) { .scroll { max-height: 300px; } }
  .checks { list-style: none; margin: 0; padding: 0; }
  .checks label { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--space-1); border-top: 1px solid var(--line); cursor: pointer; }
  .checks li:first-child label { border-top: 0; }
  .checks input { width: 20px; height: 20px; accent-color: var(--accent); }
  .name { flex: 1; font-weight: 500; }
  .count { font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-3); transition: color 300ms; }
  .count.flash { color: var(--accent); font-weight: 700; animation: pop 1.2s ease-out; }
  @keyframes pop { 0% { transform: scale(1.4); } 30% { transform: scale(1); } 100% { transform: scale(1); } }
  .nomatch { margin: 0; padding: var(--space-3) var(--space-2); color: var(--text-3); font-size: calc(var(--text-sm) * var(--size-app)); }
  .hint { margin: calc(-1 * var(--space-1)) 0 0; font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-3); }
  .new { display: flex; align-items: center; gap: var(--space-2); }
  .new :global(.grow) { flex: 1; min-width: 0; }
  .plus { width: 20px; text-align: center; color: var(--accent); font-size: calc(var(--text-xl) * var(--size-app)); line-height: 1; font-weight: 600; flex: none; }
</style>
