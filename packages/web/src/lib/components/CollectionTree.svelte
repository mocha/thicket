<script lang="ts">
  /**
   * A person's collections, shown as the tree they are: the same shape the
   * sidebar shows. Top level is anything whose parent isn't in the list: the
   * root, which is nobody's page, and also a collection whose parent this
   * reader may not see, which keeps that child reachable instead of hiding it
   * under something absent.
   *
   * Drawn on a profile's Overview (`limit`: the first few, no New collection),
   * its Collections tab, and your own Collections page. On your own, New
   * collection leads the list, so it's never below a long scroll.
   *
   * `filter` binds the text of a filter box the caller draws (issue #178): it
   * narrows the list to names containing it, ignoring capitals. A search wants
   * a flat list of matches, so ones that sit inside another collection show too.
   *
   * `lead` goes at the top of the card, above the list: on a profile tab, the
   * line saying who can see it and the filter box, as Explore leads its cards.
   */
  import type { Snippet } from 'svelte';
  import { api, collectionsApi, collectionHref, publicCollectionHref, type ProfileCollection } from '$lib/api';
  import { goto } from '$app/navigation';
  import { session } from '$lib/session.svelte';
  import { showToast } from '$lib/toast.svelte';
  import { audienceTag } from '$lib/visibility';
  import { loadCollections } from '$lib/collections.svelte';
  import { marks, countText } from '$lib/marks.svelte';
  import { display } from '$lib/display.svelte';
  import Badge from './Badge.svelte';
  import Button from './Button.svelte';
  import Field from './Field.svelte';
  import Input from './Input.svelte';

  let { collections: cols, handle, isMe, limit, filter = '', via = 'profile', lead }: {
    collections: ProfileCollection[]; handle: string; isMe: boolean; limit?: number; filter?: string; via?: string; lead?: Snippet;
  } = $props();

  $effect(() => { if (isMe) void loadCollections(); });

  const colIds = $derived(new Set(cols.map((c) => c.id)));
  const topCols = $derived(cols.filter((c) => c.parentId === null || !colIds.has(c.parentId)));
  const childCols = (id: number) => cols.filter((c) => c.parentId === id);
  const query = $derived(filter.trim().toLowerCase());
  const matches = $derived(query ? cols.filter((c) => c.name.toLowerCase().includes(query)) : []);
  const creatable = $derived(isMe && limit === undefined);

  let creating = $state(false);
  let newName = $state('');
  let newBusy = $state(false);
  let newInput = $state<HTMLInputElement | null>(null);
  async function createCollection() {
    const name = newName.trim();
    if (!name || newBusy || !session.user) return;
    newBusy = true;
    try {
      const c = await collectionsApi.create(name);
      api.event('collection_created', { collectionId: c.id, via });
      await loadCollections(true);
      creating = false; newName = '';
      await goto(collectionHref(session.user.handle, c.slug));
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    } finally {
      newBusy = false;
    }
  }
</script>

{#snippet colRow(c: ProfileCollection, depth: number, withKids = true)}
  <li class:nested={depth > 0}>
    <a href={publicCollectionHref(handle, c.slug)} style:--indent="{depth * 18}px">
      <div class="meta">
        <span class="name">{c.name}{#if isMe && audienceTag(c.visibility)}<Badge class="aftertext">{audienceTag(c.visibility)}</Badge>{/if}</span>
        {#if c.description}<span class="desc">{c.description}</span>{/if}
      </div>
      {#if isMe && display.fresh && countText(marks.byId[c.id])}<Badge tone="accent">{countText(marks.byId[c.id])} new</Badge>{/if}
      {#if c.copiedByMe}<Badge>Copied</Badge>{/if}
      <span class="count">{c.feedCount} {c.feedCount === 1 ? 'feed' : 'feeds'}</span>
      <span class="chev" aria-hidden="true">›</span>
    </a>
  </li>
  {#if withKids}
    {#each childCols(c.id) as k (k.id)}
      {@render colRow(k, depth + 1)}
    {/each}
  {/if}
{/snippet}

<div class="card">
  {@render lead?.()}
  {#if cols.length === 0 && !creatable}
    <div class="pad"><p class="status">{isMe ? 'A collection is a handful of feeds you read together.' : 'No collections to show.'}</p></div>
  {:else}
    <ul class="list">
      {#if creatable}
        <li class="new">
          {#if creating}
            <form onsubmit={(e) => { e.preventDefault(); void createCollection(); }}>
              <Field label="New collection name" hideLabel class="grow">
                {#snippet children({ id })}
                  <Input
                    {id}
                    bind:element={newInput}
                    variant="create"
                    inset
                    bind:value={newName}
                    placeholder="Name it, e.g. News"
                    maxlength="60"
                    disabled={newBusy}
                    onkeydown={(e: KeyboardEvent) => { if (e.key === 'Escape') creating = false; }}
                  >
                    {#snippet trailing()}
                      <Button type="submit" variant="primary" disabled={newBusy || !newName.trim()}>{newBusy ? 'Creating…' : 'Create'}</Button>
                    {/snippet}
                  </Input>
                {/snippet}
              </Field>
            </form>
          {:else}
            <button class="add tap" onclick={() => { creating = true; queueMicrotask(() => newInput?.focus()); }}><span class="plus" aria-hidden="true">+</span> New collection</button>
          {/if}
        </li>
      {/if}
      {#if query}
        {#each matches as c (c.id)}
          {@render colRow(c, 0, false)}
        {/each}
      {:else if limit !== undefined}
        <!-- A preview: the first few at the top level, without what's inside them. -->
        {#each topCols.slice(0, limit) as c (c.id)}
          {@render colRow(c, 0, false)}
        {/each}
      {:else}
        {#each topCols as c (c.id)}
          {@render colRow(c, 0)}
        {/each}
      {/if}
    </ul>
    <p class="nomatch" aria-live="polite">{#if query && matches.length === 0}No collections match “{filter.trim()}”{/if}</p>
    {#if cols.length === 0 && isMe}
      <div class="pad"><p class="status">A collection is a handful of feeds you read together. Make one above, then add feeds to it from any feed’s Follow menu.</p></div>
    {/if}
  {/if}
</div>

<style>
  .card { background: var(--surface); border-radius: var(--radius); box-shadow: var(--shadow); overflow: hidden; }
  .pad { padding: var(--space-4); }
  .status { color: var(--text-2); font-size: calc(var(--text-sm) * var(--size-app)); padding: var(--space-2) 0; margin: 0; }
  .list { list-style: none; margin: 0; padding: 0; }
  li a { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--space-4) var(--space-3) calc(var(--space-4) + var(--indent, 0px)); border-top: 1px solid var(--line); }
  li:first-child a { border-top: 0; }
  /* A sub-collection is indented and its name sits quieter than its parent's, so the tree reads at a glance. */
  .nested .name { font-weight: 500; color: var(--text-2); }
  .meta { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .name { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  /* A pill riding after a name needs its own gap: the words beside it are text, not a flex row. */
  .name :global(.aftertext) { margin-left: var(--space-2); }
  .desc { font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .count { font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); white-space: nowrap; }
  .chev { color: var(--text-3); font-size: calc(var(--text-xl) * var(--size-app)); }
  .add { display: flex; align-items: center; gap: var(--space-3); width: 100%; padding: var(--space-3) var(--space-4); border-top: 1px solid var(--line); color: var(--accent); font-weight: 600; font-size: calc(var(--text-base) * var(--size-app)); text-align: left; }
  li:first-child .add, li:first-child form { border-top: 0; }
  .plus { font-size: calc(var(--text-xl) * var(--size-app)); line-height: 1; width: 14px; }
  .new form { display: flex; gap: var(--space-2); padding: var(--space-3) var(--space-4); border-top: 1px solid var(--line); }
  .new form :global(.grow) { flex: 1; min-width: 0; }
  .nomatch { margin: 0; padding: 0 var(--space-4); color: var(--text-2); font-size: calc(var(--text-sm) * var(--size-app)); }
  .nomatch:not(:empty) { padding: var(--space-3) var(--space-4); border-top: 1px solid var(--line); }
</style>
