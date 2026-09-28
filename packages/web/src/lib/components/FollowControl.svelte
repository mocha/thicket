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
  import SavedNote from './SavedNote.svelte';
  import { showToast } from '$lib/toast.svelte';

  let { feedId, ids = $bindable(), name = 'this feed', compact = false, inline = false, mainLabel, onmain, onchange }: {
    feedId: number; ids: number[]; name?: string; compact?: boolean; inline?: boolean; mainLabel?: string; onmain?: () => void; onchange?: (ids: number[]) => void;
  } = $props();

  let open = $state(false);
  /** On for a moment after a tick in the checklist reaches the server. */
  let saved = $state(false);
  let anchor = $state<HTMLElement | null>(null);
  let panel = $state<HTMLElement | null>(null);
  let pos = $state<{ top: number; left: number; up: boolean; max: number }>({ top: 0, left: 0, up: false, max: 0 });
  /** The list has scrolled off its top rows; a line under the heading says so. */
  let scrolled = $state(false);

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
    // On a phone the main nav is a bar pinned to the bottom of the screen; the
    // panel stops above it rather than covering its tabs. On desktop the nav
    // is the sidebar, whose top is at the top, so the window edge is the floor.
    const bar = document.querySelector('nav')?.getBoundingClientRect();
    const floor = bar && bar.top > window.innerHeight / 2 ? bar.top : window.innerHeight;
    // Room on each side, less the 8px gap to the button and 8px to the edge.
    const below = floor - r.bottom - 16;
    const above = r.top - 16;
    // Below reads most naturally, so it wins whenever a useful few rows fit
    // there; otherwise open toward the roomier side.
    const up = below < 420 && above > below;
    // The panel never grows past the window edge on the side it opens toward;
    // the checklist scrolls inside it instead.
    pos = { top: up ? r.top - 8 : r.bottom + 8, left, up, max: up ? above : below };
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
    // Follow the button when the page scrolls or the window resizes. Scrolls
    // inside the panel (its own list) don't move the button, so skip those.
    const onMove = (e: Event) => { if (!inline && !panel?.contains(e.target as Node)) place(); };
    const onList = (e: Event) => { const t = e.target as HTMLElement; if (t.classList?.contains('checks') && panel?.contains(t)) scrolled = t.scrollTop > 0; };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onMove);
    document.addEventListener('scroll', onMove, true);
    document.addEventListener('scroll', onList, true);
    return () => {
      document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onMove); document.removeEventListener('scroll', onMove, true); document.removeEventListener('scroll', onList, true);
      scrolled = false;
    };
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
  <div class="panel" class:inline bind:this={panel} style:top={inline ? undefined : `${pos.top}px`} style:left={inline ? undefined : `${pos.left}px`} style:transform={inline || !pos.up ? 'none' : 'translateY(-100%)'} style:max-height={inline ? undefined : `${pos.max}px`} role={inline ? 'group' : 'dialog'} aria-label="Collections for {name}">
    <div class="eyebrow" class:scrolled><span>{following ? 'In your collections' : 'Follow into a collection'}</span><SavedNote show={saved} /></div>
    <CollectionCheckList {feedId} bind:ids bind:saved {name} onchange={(next) => onchange?.(next)} />
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
  .main { padding: var(--space-2) var(--space-3) var(--space-2) var(--space-4); font-size: calc(var(--text-sm) * var(--size-app)); font-weight: 600; color: inherit; white-space: nowrap; max-width: 20ch; overflow: hidden; text-overflow: ellipsis; }
  .more { padding: 0 var(--space-2); border-left: 1px solid color-mix(in srgb, var(--accent) 30%, transparent); display: grid; place-items: center; color: inherit; }
  .main:hover, .more:hover { background: color-mix(in srgb, var(--accent) 12%, transparent); }
  .compact .main { padding: var(--space-1) var(--space-3); font-size: calc(var(--text-sm) * var(--size-app)); }
  .compact .more { padding: 0 var(--space-1); }
  .panel {
    position: fixed; z-index: 60; width: min(320px, calc(100vw - 16px));
    background: var(--surface); color: var(--text); border-radius: var(--radius-md); padding: var(--space-3) var(--space-4);
    box-shadow: var(--shadow-menu);
    display: flex; flex-direction: column;
  }
  /* The panel's height is capped to the room beside the button (see place()).
     A long list of collections scrolls inside it rather than pushing Unfollow
     (or the panel) off screen. */
  .panel:not(.inline) > :global(*) { flex-shrink: 0; }
  .panel:not(.inline) > :global(.checks) { overflow-y: auto; min-height: 0; max-height: 50vh; flex-shrink: 1; }
  .panel.inline { position: static; width: 100%; flex-basis: 100%; order: 10; box-shadow: none; border: 1px solid var(--line); padding: var(--space-3); }
  /* Inside a sheet the list scrolls on its own so Unfollow stays in reach. */
  .panel.inline :global(.checks) { max-height: 34vh; overflow-y: auto; }
  .eyebrow { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); font-size: calc(var(--text-xs) * var(--size-app)); text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-3); padding-bottom: var(--space-1); border-bottom: 1px solid transparent; }
  /* Once the list scrolls under the heading, a rule marks the edge so the top rows read as scrolled away, not missing. */
  .eyebrow.scrolled { border-bottom-color: var(--line); }
  .unfollow { width: 100%; margin-top: var(--space-3); padding: var(--space-2); border-radius: var(--radius-sm); color: var(--danger); font-weight: 600; font-size: calc(var(--text-sm) * var(--size-app)); border: 1px solid var(--line); }
  .unfollow:hover { background: color-mix(in srgb, var(--danger) 10%, transparent); }
</style>
