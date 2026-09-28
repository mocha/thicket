<script lang="ts">
  /**
   * Which of my collections hold this feed. Saves on every toggle, and the
   * boxes are the whole of "do I follow this": ticking the first one follows
   * it, unticking the last one unfollows it. A feed still lives in at least
   * one collection — "followed but filed nowhere" remains impossible — it is
   * just that emptying the list is a legitimate way to say you are done with
   * a feed, rather than an error to be corrected.
   * With no Save button, a tick needs a receipt (issue #101): `saved` turns on
   * for a moment once the server has the change, for the surrounding panel to
   * show as "Saved" by its heading. Following for the first time also says so
   * in a toast with Undo, the mirror of the one unfollowing shows. A failed
   * save puts the boxes back and says why.
   */
  import { api, collectionsApi } from '$lib/api';
  import { collectionStore, loadCollections, namedCollections } from '$lib/collections.svelte';
  import { showToast } from '$lib/toast.svelte';
  import Button from './Button.svelte';
  import Field from './Field.svelte';
  import Input from './Input.svelte';

  let { feedId, ids = $bindable(), name = 'this feed', saved = $bindable(false), onchange }: { feedId: number; ids: number[]; name?: string; saved?: boolean; onchange?: (ids: number[]) => void } = $props();
  let newName = $state('');
  let busy = $state(false);
  /** Collection ids whose count just went up; drives the green flash. */
  let flash = $state<Set<number>>(new Set());
  function flashCount(id: number) {
    flash = new Set([...flash, id]);
    setTimeout(() => { const n = new Set(flash); n.delete(id); flash = n; }, 1200);
  }

  $effect(() => { void loadCollections(); });

  let savedTimer: ReturnType<typeof setTimeout> | undefined;
  /** Counts saves, so a failure only rolls back the boxes if nothing was ticked since. */
  let seq = 0;

  /** Resolves true once the server has it. */
  async function save(next: number[]): Promise<boolean> {
    const prev = ids;
    const mine = ++seq;
    ids = next;
    saved = false;
    try {
      await collectionsApi.setFeedCollections(feedId, next);
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      if (mine === seq) ids = prev;
      showToast(`Couldn’t save that change to ${name}: ${reason}`);
      api.event('feed_collections_save_failed', { feedId, collectionIds: next, reason });
      return false;
    }
    onchange?.(next);
    void loadCollections(true);
    if (mine === seq) {
      saved = true;
      clearTimeout(savedTimer);
      savedTimer = setTimeout(() => (saved = false), 2000);
    }
    return true;
  }

  $effect(() => () => clearTimeout(savedTimer));

  async function toggle(id: number) {
    if (ids.includes(id)) {
      const next = ids.filter((x) => x !== id);
      const prev = ids;
      if (!(await save(next))) return;
      // Taking it out of the last collection is unfollowing. Say so plainly and
      // offer the way back, the same as the Unfollow button does.
      if (next.length === 0) {
        api.event('feed_unfollowed', { feedId, via: 'checklist' });
        showToast(`Unfollowed ${name}`, { label: 'Undo', run: () => void save(prev) });
      } else {
        api.event('feed_unfiled', { feedId, collectionId: id });
      }
      return;
    }
    const first = ids.length === 0;
    flashCount(id);
    if (!(await save([...ids, id]))) return;
    api.event(first ? 'feed_followed' : 'feed_filed', { feedId, collectionId: id });
    if (first) {
      const where = namedCollections().find((c) => c.id === id)?.name;
      showToast(where ? `Following ${name} in ${where}` : `Following ${name}`, { label: 'Undo', run: () => void save([]) });
    }
  }

  async function createAndAdd() {
    const name = newName.trim();
    if (!name || busy) return;
    busy = true;
    try {
      const c = await collectionsApi.create(name);
      await loadCollections(true);
      newName = '';
      api.event('collection_created', { collectionId: c.id, via: 'checklist' });
      void toggle(c.id);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    } finally {
      busy = false;
    }
  }
</script>

<ul class="checks">
  {#each namedCollections() as c (c.id)}
    <li>
      <label>
        <input type="checkbox" checked={ids.includes(c.id)} onchange={() => void toggle(c.id)} />
        <span class="name">{c.name}</span>
        <span class="count" class:flash={flash.has(c.id)}>{c.feedCount}</span>
      </label>
    </li>
  {/each}
</ul>
{#if collectionStore.loaded}
  <p class="hint">{namedCollections().length ? 'Every feed you follow lives in at least one collection.' : 'You have no collections yet. Start one below to file this feed.'}</p>
{/if}
<form class="new" onsubmit={(e) => { e.preventDefault(); void createAndAdd(); }}>
  <span class="plus" aria-hidden="true">+</span>
  <Field label="New collection name" hideLabel class="grow">
    {#snippet children({ id })}
      <Input {id} variant="create" bind:value={newName} placeholder="Start a new collection…" disabled={busy}>
        {#snippet trailing()}
          <Button type="submit" variant="primary" disabled={busy || !newName.trim()}>Create</Button>
        {/snippet}
      </Input>
    {/snippet}
  </Field>
</form>

<style>
  .checks { list-style: none; margin: 0; padding: 0; }
  li label { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--space-1); border-top: 1px solid var(--line); cursor: pointer; }
  li:first-child label { border-top: 0; }
  input[type='checkbox'] { width: 20px; height: 20px; accent-color: var(--accent); }
  .name { flex: 1; font-weight: 500; }
  .count { font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-3); transition: color 300ms; }
  .count.flash { color: var(--accent); font-weight: 700; animation: pop 1.2s ease-out; }
  @keyframes pop { 0% { transform: scale(1.4); } 30% { transform: scale(1); } 100% { transform: scale(1); } }
  .hint { margin: var(--space-2) 0 0; font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-3); }
  .new { display: flex; align-items: center; gap: var(--space-2); margin-top: var(--space-3); padding-top: var(--space-3); border-top: 1px solid var(--line); }
  .plus { width: 20px; text-align: center; color: var(--accent); font-size: calc(var(--text-xl) * var(--size-app)); line-height: 1; font-weight: 600; }
  .new :global(.grow) { flex: 1; min-width: 0; }
</style>
