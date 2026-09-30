<script lang="ts">
  /**
   * The follow control: the one place to see and change "my relationship to
   * this feed". One button naming the state, which opens the Follow sheet:
   *   not following            → [ Follow ]
   *   following, 1 collection  → [ In Tech News ]
   *   following, N collections → [ In N collections ]
   * It used to be a split button with a caret half, but both halves opened the
   * same sheet, so the caret was a second target that did nothing new.
   * Following is *filing*: you pick where it goes, and picking nowhere is how
   * you stop following. Follow used to file into your oldest collection and
   * tell you which in a toast; being moved somewhere you didn't choose read as
   * the app deciding for you, so now the choice comes first.
   * The choosing happens in a Sheet like Add a feed's, not a menu hanging off
   * the button: a long list of collections needs the room, and filing a feed
   * should look the same however you got there.
   */
  import { api } from '$lib/api';
  import { collectionStore, loadCollections } from '$lib/collections.svelte';
  import FollowSheet from './FollowSheet.svelte';

  let { feedId, ids = $bindable(), name = 'this feed', compact = false, onchange }: {
    feedId: number; ids: number[]; name?: string; compact?: boolean; onchange?: (ids: number[]) => void;
  } = $props();

  let open = $state(false);

  const following = $derived(ids.length > 0);
  /**
   * Filed in exactly one place, the button names it: "In Tech News" answers
   * "where did this go" outright, where "In 1 collection" makes you open the
   * sheet to find out. Past one there is no name to give, so it counts.
   * The name comes from the shared list, which may not have loaded yet — until
   * it does, the count is the honest thing to show.
   */
  const only = $derived(ids.length === 1 ? collectionStore.list.find((c) => c.id === ids[0]) : null);
  const label = $derived(
    !following ? 'Follow' : only ? `In ${only.name}` : ids.length === 1 ? 'In 1 collection' : `In ${ids.length} collections`
  );

  function show() {
    open = true;
    api.event('follow_panel_opened', { feedId });
  }

  // Needed to name the one collection on the button, before the sheet is opened.
  $effect(() => { if (following) void loadCollections(); });
</script>

<button class="follow" class:on={following} class:compact onclick={show} aria-haspopup="dialog" aria-expanded={open}>{label}</button>

{#if open}
  <FollowSheet {feedId} bind:ids {name} {onchange} onclose={() => (open = false)} />
{/if}

<style>
  /* A collection name can be long; the button gives it room, then ellipsis. */
  .follow { flex: none; padding: var(--space-2) var(--space-4); border-radius: var(--radius-pill); border: 1px solid var(--accent); background: var(--surface); color: var(--accent); font-size: calc(var(--text-sm) * var(--size-app)); font-weight: 600; white-space: nowrap; max-width: 20ch; overflow: hidden; text-overflow: ellipsis; }
  .follow.on { background: color-mix(in srgb, var(--accent) 14%, transparent); border-color: transparent; }
  .follow:hover { background: color-mix(in srgb, var(--accent) 12%, var(--surface)); }
  .follow.on:hover { background: color-mix(in srgb, var(--accent) 22%, transparent); }
  .compact { padding: var(--space-1) var(--space-4); }
</style>
