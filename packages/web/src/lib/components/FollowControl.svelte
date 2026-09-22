<script lang="ts">
  /**
   * The follow control: the one place to see and change "my relationship to
   * this feed". A split button — a main half naming the state, a caret half
   * opening the filing menu:
   *   not following            → [ Follow | ▾ ]
   *   following, 1 collection  → [ In Tech News | ▾ ]
   *   following, N collections → [ In N collections | ▾ ]
   * Either half opens the same panel. Following is *filing*: you pick where it
   * goes, and picking nowhere is how you stop following. Follow used to file
   * into your oldest collection and tell you which in a toast; being moved
   * somewhere you didn't choose read as the app deciding for you, so now the
   * choice comes first.
   * Unfollow stays in the panel as a shortcut for "take it out of all of
   * these", which is worth one click when a feed sits in five collections.
   * `mainLabel` + `onmain` repurpose the main half for a page-specific action
   * ("Remove from Tech News" on a Manage page) while ▾ still opens the same
   * checklist, so filing is one control everywhere.
   * `inline` renders the panel in flow under the button instead of floating.
   * Use it inside dialogs: a transformed/top-layer ancestor breaks fixed
   * positioning, and the panel would land off screen.
   */
  import { api } from '$lib/api';
  import { collectionStore, loadCollections } from '$lib/collections.svelte';
  import CollectionCheckList from './CollectionCheckList.svelte';
  import Icon from './Icon.svelte';
  import { showToast } from '$lib/toast.svelte';

  let { feedId, ids = $bindable(), name = 'this feed', compact = false, inline = false, mainLabel, onmain, onchange }: {
    feedId: number; ids: number[]; name?: string; compact?: boolean; inline?: boolean; mainLabel?: string; onmain?: () => void; onchange?: (ids: number[]) => void;
  } = $props();

  let open = $state(false);
  let anchor = $state<HTMLElement | null>(null);
  let panel = $state<HTMLElement | null>(null);
  let pos = $state<{ top: number; left: number; up: boolean }>({ top: 0, left: 0, up: false });

  const following = $derived(ids.length > 0);
  /**
   * Filed in exactly one place, the button names it: "In Tech News" answers
   * "where did this go" outright, where "In 1 collection" makes you open the
   * panel to find out. Past one there is no name to give, so it counts.
   * The name comes from the shared list, which may not have loaded yet — until
   * it does, the count is the honest thing to show.
   */
  const only = $derived(ids.length === 1 ? collectionStore.list.find((c) => c.id === ids[0]) : null);
  const label = $derived(
    !following ? 'Follow' : only ? `In ${only.name}` : ids.length === 1 ? 'In 1 collection' : `In ${ids.length} collections`
  );

  async function unfollow() {
    const removed = await api.unfollow(feedId);
    const prev = ids;
    ids = [];
    onchange?.(ids);
    open = false;
    api.event('feed_unfollowed', { feedId, via: 'follow_button' });
    void loadCollections(true);
    showToast(`Unfollowed ${name}`, {
      label: 'Undo',
      run: async () => { const r = await api.restore(feedId, removed.collectionIds.length ? removed.collectionIds : prev); ids = r.collectionIds; onchange?.(ids); void loadCollections(true); }
    });
  }

  function place() {
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const width = Math.min(320, window.innerWidth - 16);
    const left = Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8));
    const spaceBelow = window.innerHeight - r.bottom;
    const up = spaceBelow < 320 && r.top > spaceBelow;
    // Never let a tall panel run off the top; the checklist scrolls instead (see .panel max-height).
    pos = { top: up ? Math.max(r.top - 8, Math.min(r.top - 8, window.innerHeight - 8)) : r.bottom + 8, left, up };
  }

  function toggle() {
    if (!open && !inline) place();
    open = !open;
    if (open) api.event('follow_panel_opened', { feedId });
  }

  // Needed to name the one collection on the button, before the panel is opened.
  $effect(() => { if (following) void loadCollections(); });

  $effect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!panel?.contains(e.target as Node) && !anchor?.contains(e.target as Node)) open = false; };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') open = false; };
    const onScroll = () => place();
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onScroll);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); window.removeEventListener('resize', onScroll); };
  });
</script>

<div class="split" class:on={following && !onmain} class:neutral={!!onmain} class:compact bind:this={anchor}>
  {#if onmain}
    <button class="main" onclick={onmain}>{mainLabel ?? label}</button>
  {:else}
    <button class="main" onclick={toggle} aria-expanded={open}>{label}</button>
  {/if}
  <button class="more" onclick={toggle} aria-expanded={open} aria-label="More options for {name}">
    <Icon name="caret" dir="down" size={16} stroke={2.2} />
  </button>
</div>

{#if open}
  <div class="panel" class:inline bind:this={panel} style:top={inline ? undefined : `${pos.top}px`} style:left={inline ? undefined : `${pos.left}px`} style:transform={inline || !pos.up ? 'none' : 'translateY(-100%)'} role={inline ? 'group' : 'dialog'} aria-label="Collections for {name}">
    <div class="eyebrow">{following ? 'In your collections' : 'Follow into a collection'}</div>
    <CollectionCheckList {feedId} bind:ids {name} onchange={(next) => onchange?.(next)} />
    {#if following}
      <button class="unfollow" onclick={unfollow}>Unfollow</button>
    {/if}
  </div>
{/if}

<style>
  .split { display: inline-flex; align-items: stretch; border-radius: var(--radius-pill); border: 1px solid var(--accent); overflow: hidden; background: var(--surface); color: var(--accent); flex: none; }
  .split.on { background: color-mix(in srgb, var(--accent) 14%, transparent); border-color: transparent; }
  .split.neutral { border-color: var(--line); color: var(--text-2); }
  .split.neutral .more { border-left-color: var(--line); }
  /* A collection name can be long; the button gives it room, then ellipsis. */
  .main { padding: 8px 12px 8px 14px; font-size: calc(var(--text-sm) * var(--size-app)); font-weight: 600; color: inherit; white-space: nowrap; max-width: 20ch; overflow: hidden; text-overflow: ellipsis; }
  .more { padding: 0 8px 0 6px; border-left: 1px solid color-mix(in srgb, var(--accent) 30%, transparent); display: grid; place-items: center; color: inherit; }
  .main:hover, .more:hover { background: color-mix(in srgb, var(--accent) 12%, transparent); }
  .compact .main { padding: 6px 10px 6px 12px; font-size: calc(var(--text-sm) * var(--size-app)); }
  .compact .more { padding: 0 6px 0 4px; }
  .panel {
    position: fixed; z-index: 60; width: min(320px, calc(100vw - 16px));
    background: var(--surface); color: var(--text); border-radius: var(--radius-md); padding: 12px 14px;
    box-shadow: var(--shadow-menu);
    max-height: calc(100vh - 16px); display: flex; flex-direction: column;
  }
  /* A long list of collections scrolls inside the panel rather than pushing Unfollow (or the panel) off screen. */
  .panel:not(.inline) :global(.checks) { overflow-y: auto; min-height: 0; max-height: 50vh; }
  .panel.inline { position: static; width: 100%; flex-basis: 100%; order: 10; box-shadow: none; border: 1px solid var(--line); padding: 10px 12px; }
  /* Inside a sheet the list scrolls on its own so Unfollow stays in reach. */
  .panel.inline :global(.checks) { max-height: 34vh; overflow-y: auto; }
  .eyebrow { font-size: calc(var(--text-xs) * var(--size-app)); text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-3); margin-bottom: 4px; }
  .unfollow { width: 100%; margin-top: 10px; padding: 9px; border-radius: var(--radius-sm); color: var(--danger); font-weight: 600; font-size: calc(var(--text-sm) * var(--size-app)); border: 1px solid var(--line); }
  .unfollow:hover { background: color-mix(in srgb, var(--danger) 10%, transparent); }
</style>
