<script lang="ts">
  /**
   * The follow control: the one place to see and change "my relationship to
   * this feed". A split button — a main half naming the state, a caret half
   * opening the Follow sheet:
   *   not following            → [ Follow | ▾ ]
   *   following, 1 collection  → [ In Tech News | ▾ ]
   *   following, N collections → [ In N collections | ▾ ]
   * Either half opens the same sheet. Following is *filing*: you pick where it
   * goes, and picking nowhere is how you stop following. Follow used to file
   * into your oldest collection and tell you which in a toast; being moved
   * somewhere you didn't choose read as the app deciding for you, so now the
   * choice comes first.
   * The choosing happens in a Sheet like Add a feed's, not a menu hanging off
   * the button: a long list of collections needs the room, and filing a feed
   * should look the same however you got there.
   * `mainLabel` + `onmain` repurpose the main half for a page-specific action
   * ("Remove from Tech News" on a Manage page) while ▾ still opens the same
   * sheet, so filing is one control everywhere.
   */
  import { api } from '$lib/api';
  import { collectionStore, loadCollections } from '$lib/collections.svelte';
  import FollowSheet from './FollowSheet.svelte';
  import Icon from './Icon.svelte';

  let { feedId, ids = $bindable(), name = 'this feed', compact = false, mainLabel, onmain, onchange }: {
    feedId: number; ids: number[]; name?: string; compact?: boolean; mainLabel?: string; onmain?: () => void; onchange?: (ids: number[]) => void;
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

<div class="split" class:on={following && !onmain} class:neutral={!!onmain} class:compact>
  {#if onmain}
    <button class="main" onclick={onmain}>{mainLabel ?? label}</button>
  {:else}
    <button class="main" onclick={show} aria-haspopup="dialog" aria-expanded={open}>{label}</button>
  {/if}
  <button class="more" onclick={show} aria-haspopup="dialog" aria-expanded={open} aria-label="Collections for {name}">
    <Icon name="caret" dir="down" size={16} stroke={2.2} />
  </button>
</div>

{#if open}
  <FollowSheet {feedId} bind:ids {name} {onchange} onclose={() => (open = false)} />
{/if}

<style>
  .split { display: inline-flex; align-items: stretch; border-radius: var(--radius-pill); border: 1px solid var(--accent); overflow: hidden; background: var(--surface); color: var(--accent); flex: none; }
  .split.on { background: color-mix(in srgb, var(--accent) 14%, transparent); border-color: transparent; }
  .split.neutral { border-color: var(--line); color: var(--text-2); }
  .split.neutral .more { border-left-color: var(--line); }
  /* A collection name can be long; the button gives it room, then ellipsis. */
  .main { padding: var(--space-2) var(--space-3) var(--space-2) var(--space-4); font-size: calc(var(--text-sm) * var(--size-app)); font-weight: 600; color: inherit; white-space: nowrap; max-width: 20ch; overflow: hidden; text-overflow: ellipsis; }
  .more { padding: 0 var(--space-2); border-left: 1px solid color-mix(in srgb, var(--accent) 30%, transparent); display: grid; place-items: center; color: inherit; }
  .main:hover, .more:hover { background: color-mix(in srgb, var(--accent) 12%, transparent); }
  .compact .main { padding: var(--space-1) var(--space-3); font-size: calc(var(--text-sm) * var(--size-app)); }
  .compact .more { padding: 0 var(--space-1); }
</style>
