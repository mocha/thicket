<script lang="ts">
  /**
   * Which of my collections hold this feed. Saves on every toggle, and the
   * boxes are the whole of "do I follow this": ticking the first one follows
   * it, unticking the last one unfollows it. A feed still lives in at least
   * one collection — "followed but filed nowhere" remains impossible — it is
   * just that emptying the list is a legitimate way to say you are done with
   * a feed, rather than an error to be corrected.
   */
  import { api, collectionsApi } from '$lib/api';
  import { collectionStore, loadCollections, namedCollections } from '$lib/collections.svelte';
  import { showToast } from '$lib/toast.svelte';

  let { feedId, ids = $bindable(), name = 'this feed', onchange }: { feedId: number; ids: number[]; name?: string; onchange?: (ids: number[]) => void } = $props();
  let newName = $state('');
  let busy = $state(false);
  /** Collection ids whose count just went up; drives the green flash. */
  let flash = $state<Set<number>>(new Set());
  function flashCount(id: number) {
    flash = new Set([...flash, id]);
    setTimeout(() => { const n = new Set(flash); n.delete(id); flash = n; }, 1200);
  }

  $effect(() => { void loadCollections(); });

  async function save(next: number[]) {
    ids = next;
    await collectionsApi.setFeedCollections(feedId, next);
    onchange?.(next);
    void loadCollections(true);
  }

  function toggle(id: number) {
    if (ids.includes(id)) {
      const next = ids.filter((x) => x !== id);
      const prev = ids;
      void save(next);
      // Taking it out of the last collection is unfollowing. Say so plainly and
      // offer the way back, the same as the Unfollow button does.
      if (next.length === 0) {
        api.event('feed_unfollowed', { feedId, via: 'checklist' });
        showToast(`Unfollowed ${name}`, { label: 'Undo', run: () => save(prev) });
      } else {
        api.event('feed_unfiled', { feedId, collectionId: id });
      }
      return;
    }
    api.event(ids.length === 0 ? 'feed_followed' : 'feed_filed', { feedId, collectionId: id });
    flashCount(id);
    void save([...ids, id]);
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
      toggle(c.id);
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
        <input type="checkbox" checked={ids.includes(c.id)} onchange={() => toggle(c.id)} />
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
  <input type="text" placeholder="Start a new collection…" bind:value={newName} disabled={busy} />
  <button type="submit" disabled={busy || !newName.trim()}>Create</button>
</form>

<style>
  .checks { list-style: none; margin: 0; padding: 0; }
  li label { display: flex; align-items: center; gap: 12px; padding: 11px 4px; border-top: 1px solid var(--line); cursor: pointer; }
  li:first-child label { border-top: 0; }
  input[type='checkbox'] { width: 20px; height: 20px; accent-color: var(--accent); }
  .name { flex: 1; font-weight: 500; }
  .count { font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-3); transition: color 300ms; }
  .count.flash { color: var(--accent); font-weight: 700; animation: pop 1.2s ease-out; }
  @keyframes pop { 0% { transform: scale(1.4); } 30% { transform: scale(1); } 100% { transform: scale(1); } }
  .hint { margin: 6px 0 0; font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-3); }
  .new { display: flex; align-items: center; gap: 8px; margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--line); }
  .plus { width: 20px; text-align: center; color: var(--accent); font-size: calc(var(--text-xl) * var(--size-app)); line-height: 1; font-weight: 600; }
  .new input { flex: 1; min-width: 0; padding: 9px 12px; border-radius: 10px; border: 1px dashed var(--accent); background: var(--surface); color: var(--text); font-size: calc(var(--text-sm) * var(--size-app)); }
  .new input::placeholder { color: var(--accent); opacity: 0.85; }
  .new input:focus { outline: 2px solid var(--accent); outline-offset: 1px; border-style: solid; }
  .new button { padding: 9px 14px; border-radius: 10px; background: var(--accent); color: var(--accent-ink); font-weight: 600; }
  .new button:disabled { opacity: 0.35; }
</style>
