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
   * The list itself (filter, seven-row scroll, new-collection box) is the
   * shared one the Add a feed sheet uses; this adds saving on each tick.
   * `showHint={false}` leaves out the line under the list, for a surface that
   * says it elsewhere (the Follow sheet puts it at the top). `onPage` is for
   * the feed's settings page, where the list sits on the page itself.
   */
  import { api, collectionsApi } from '$lib/api';
  import { loadCollections, namedCollections, placeName } from '$lib/collections.svelte';
  import { showToast } from '$lib/toast.svelte';
  import CollectionList from './CollectionList.svelte';

  let { feedId, ids = $bindable(), name = 'this feed', saved = $bindable(false), showHint = true, onPage = false, onchange }: { feedId: number; ids: number[]; name?: string; saved?: boolean; showHint?: boolean; onPage?: boolean; onchange?: (ids: number[]) => void } = $props();
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
      const where = placeName([id]);
      showToast(where ? `Following ${name} in ${where}` : `Following ${name}`, { label: 'Undo', run: () => void save([]) });
    }
  }

  const hint = $derived(namedCollections().length ? 'Every feed you follow lives in at least one collection.' : 'You have no collections yet. Start one below to file this feed.');
</script>

<!-- A column that can shrink inside a Sheet, so the list scrolls rather than the Sheet overflowing. -->
<div class="col">
  <CollectionList {ids} {flash} {onPage} hint={showHint ? hint : undefined} via="checklist" ontoggle={(id) => void toggle(id)} oncreated={(id) => void toggle(id)} />
</div>

<style>
  .col { display: flex; flex-direction: column; gap: var(--space-3); min-height: 0; flex: 0 1 auto; }
</style>
