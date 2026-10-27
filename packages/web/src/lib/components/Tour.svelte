<script lang="ts">
  /**
   * The tour: once per account, one card per place in the menu, in the
   * menu's own order. Each card sits by the real menu item it's about, with
   * a small pointer at it, and everything else on screen is dimmed, so the
   * words and the place people will find it again are seen together. Beside
   * the sidebar on a computer; on a phone above its tab in the bottom bar, or
   * below the header for Add new feed. Each card keeps a picture of the place
   * that plays on a loop.
   *
   * It's the setup dialog's last step: the dialog closes and this opens
   * (lib/firstrun.svelte.ts). Leaving it any way at all counts as seeing it.
   *
   * Not a Sheet: the dim has to leave one menu item lit and the card has to
   * sit beside it, so it's its own full-screen dialog.
   */
  import { tick, untrack } from 'svelte';
  import { page } from '$app/state';
  import { api, authApi } from '$lib/api';
  import { session } from '$lib/session.svelte';
  import { tour } from '$lib/firstrun.svelte';
  import Button from '$lib/components/Button.svelte';
  import NewPostsScene from '$lib/components/intro/NewPostsScene.svelte';
  import FeedsScene from '$lib/components/intro/FeedsScene.svelte';
  import BookmarksScene from '$lib/components/intro/BookmarksScene.svelte';
  import CollectionsScene from '$lib/components/intro/CollectionsScene.svelte';
  import ProfileScene from '$lib/components/intro/ProfileScene.svelte';

  /** `key` is the menu item's `data-tour`. */
  const STEPS = [
    { key: 'new-posts', label: 'New posts', title: 'Every post, newest first', lead: 'From every site you follow. No algorithm picks what you see, so nothing gets buried.' },
    { key: 'collections', label: 'Collections', title: 'Read one topic at a time', lead: 'The collections you picked are here. Make your own, like Cooking or Tech, and share them for others to copy.' },
    { key: 'bookmarks', label: 'Bookmarks', title: 'Save posts for later', lead: 'Bookmark a post to keep it, and add a note with your thoughts. You choose who sees your notes.' },
    { key: 'explore', label: 'Explore', title: 'See what people here read', lead: 'Browse the sites and collections others follow, and copy any you like.' },
    { key: 'add', label: 'Add new feed', title: 'Follow any site you like', lead: 'Paste its address, and thicket finds its posts. Blogs, news sites, subreddits, and YouTube all work.' },
    { key: 'you', label: 'Profile', title: 'Your page on thicket', lead: 'Your profile is in this menu. It’s what others see, and you choose who sees each part.' }
  ];
  /** The pictures short enough to sit in the middle of the stage; the others fill it and fade at the bottom. */
  const FITS = ['add', 'explore', 'bookmarks', 'collections'];
  /** Room kept between the card, the item it points at, and the screen's edges. */
  const GAP = 12;
  const EDGE = 16;

  let step = $state(0);
  const s = $derived(STEPS[step]);
  const last = $derived(step === STEPS.length - 1);
  let dialog = $state<HTMLDialogElement | null>(null);
  let card = $state<HTMLElement | null>(null);
  let next = $state<HTMLElement | null>(null);

  /** Where things are drawn: the lit-up item, the card, and the pointer's side and offset along it. */
  type Box = { top: number; left: number; width: number; height: number };
  type Place = { hole: Box | null; top: number; left: number; side: 'left' | 'top' | 'bottom' | null; at: number };
  let place = $state<Place | null>(null);
  /** Placed once already: from then on the card glides to each new spot, but the first time it appears where it belongs. */
  let settled = $state(false);

  // In development, ?tour shows it again on an account that has seen it.
  $effect(() => { if (import.meta.env.DEV && page.url.searchParams.has('tour')) tour.open = true; });

  $effect(() => {
    if (!tour.open) return;
    untrack(() => {
      step = 0;
      api.event('tour_shown', {});
    });
    tick().then(() => dialog?.showModal());
  });

  /** The item on screen now: each place is in the menu twice (sidebar and bottom bar), and only one shows. */
  function target(key: string): HTMLElement | null {
    for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${key}"]`)) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return el;
    }
    return null;
  }

  /**
   * Beside an item in a sidebar (the left part of a wide screen); otherwise
   * above an item in the bottom half, below one in the top half. An item that
   * can't be found (a page with no Add new feed button of its own, on a
   * phone) gets the card in the middle, pointing at nothing.
   */
  function measure() {
    if (!card) return;
    if (place && !settled) settled = true;
    const el = target(s.key);
    el?.scrollIntoView({ block: 'nearest' });
    const W = innerWidth, H = innerHeight;
    const w = card.offsetWidth, h = card.offsetHeight;
    if (!el) { place = { hole: null, top: (H - h) / 2, left: (W - w) / 2, side: null, at: 0 }; return; }
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
    // A little room around the item, kept on screen so its outline isn't cut off at an edge (the bottom bar's end tabs).
    const hl = clamp(r.left - 4, 2, W - 2), ht = clamp(r.top - 4, 2, H - 2);
    const hole = { left: hl, top: ht, width: clamp(r.right + 4, 2, W - 2) - hl, height: clamp(r.bottom + 4, 2, H - 2) - ht };
    if (W >= 700 && r.right < W * 0.4) {
      const top = clamp(cy - 48, EDGE, H - h - EDGE);
      place = { hole, top, left: r.right + GAP + 8, side: 'left', at: cy - top };
    } else {
      const left = clamp(cx - w / 2, EDGE, W - w - EDGE);
      const above = cy > H / 2;
      place = { hole, top: above ? r.top - GAP - 8 - h : r.bottom + GAP + 8, left, side: above ? 'bottom' : 'top', at: clamp(cx - left, 24, w - 24) };
    }
  }

  // Each step: wait for its words and picture to be drawn, then measure, place, and put the keyboard on the main button.
  $effect(() => {
    if (!tour.open) return;
    void step;
    tick().then(() => { measure(); next?.querySelector('button')?.focus(); });
    const again = () => measure();
    addEventListener('resize', again);
    return () => removeEventListener('resize', again);
  });

  function finish(how: 'done' | 'dismissed' | 'skipped') {
    if (!tour.open) return;
    api.event('tour_closed', { how, step: s.key });
    const u = session.user;
    if (u && !u.tourSeenAt) {
      u.tourSeenAt = new Date().toISOString();
      authApi.tourSeen();
    }
    tour.open = false;
    place = null;
    settled = false;
    dialog?.close();
    const after = tour.after;
    tour.after = null;
    tour.done = 'Start reading';
    after?.();
  }
</script>

{#if tour.open}
  <dialog bind:this={dialog} onclose={() => finish('dismissed')} aria-labelledby="tour-title">
    <!-- The dim, with a hole where the item is. -->
    {#if place?.hole}
      <div class="hole" style:top="{place.hole.top}px" style:left="{place.hole.left}px" style:width="{place.hole.width}px" style:height="{place.hole.height}px" aria-hidden="true"></div>
    {:else}
      <div class="dim" aria-hidden="true"></div>
    {/if}
    <div class="card {place?.side ?? ''}" class:placed={!!place} class:settled bind:this={card} style:top="{place?.top ?? 0}px" style:left="{place?.left ?? 0}px" style:--at="{place?.at ?? 0}px">
      <div class="stage" aria-hidden="true">
        {#key s.key}
          <div class="scene" class:fit={FITS.includes(s.key)}>
            {#if s.key === 'new-posts'}<NewPostsScene />
            {:else if s.key === 'collections'}<CollectionsScene />
            {:else if s.key === 'bookmarks'}<BookmarksScene />
            {:else if s.key === 'explore'}<FeedsScene only="explore" />
            {:else if s.key === 'add'}<FeedsScene only="add" />
            {:else}<ProfileScene />{/if}
          </div>
        {/key}
      </div>
      <div class="words" aria-live="polite">
        {#key s.key}
          <div class="enter">
            <h2 id="tour-title">{s.title}</h2>
            <p class="lead">{s.lead}</p>
          </div>
        {/key}
      </div>
      <footer>
        <span class="skip">{#if !last}<Button link onclick={() => finish('skipped')}>Skip this tour</Button>{/if}</span>
        <span class="dots">
          {#each STEPS as d, i (d.key)}
            <button type="button" class="dot" class:on={step === i} aria-label={d.label} aria-current={step === i ? 'step' : undefined} onclick={() => (step = i)}></button>
          {/each}
        </span>
        <span class="go" bind:this={next}>
          {#if !last}<Button variant="primary" onclick={() => step++}>Next</Button>
          {:else}<Button variant="primary" onclick={() => finish('done')}>{tour.done}</Button>{/if}
        </span>
      </footer>
    </div>
  </dialog>
{/if}

<style>
  /* The whole screen, see-through: the hole's shadow is the dim. */
  dialog { border: 0; padding: 0; margin: 0; background: transparent; width: 100vw; height: 100vh; max-width: 100vw; max-height: 100vh; overflow: hidden; }
  dialog::backdrop { background: transparent; }
  .dim { position: fixed; inset: 0; background: var(--scrim); }
  /* The item stays lit: a rounded hole whose shadow covers everything else. */
  .hole {
    position: fixed; border-radius: var(--radius-sm); box-shadow: 0 0 0 200vmax var(--scrim); outline: 2px solid var(--accent); outline-offset: 0;
    transition: top 350ms cubic-bezier(0.2, 0.8, 0.2, 1), left 350ms cubic-bezier(0.2, 0.8, 0.2, 1), width 350ms cubic-bezier(0.2, 0.8, 0.2, 1), height 350ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  .card {
    position: fixed; width: min(400px, calc(100vw - 32px)); display: flex; flex-direction: column;
    background: var(--surface); color: var(--text); border-radius: var(--radius-lg); box-shadow: var(--shadow-sheet);
    visibility: hidden;
  }
  .card.settled { transition: top 350ms cubic-bezier(0.2, 0.8, 0.2, 1), left 350ms cubic-bezier(0.2, 0.8, 0.2, 1); }
  /* Hidden until it has been measured and placed, so it never flashes in the corner. */
  .card.placed { visibility: visible; }
  /* The pointer: a small square turned on its corner, half under the card's edge, at the item. */
  .card::after { content: ''; position: absolute; width: 14px; height: 14px; background: var(--surface); transform: rotate(45deg); display: none; }
  .card.left::after { display: block; left: -7px; top: calc(var(--at) - 7px); }
  .card.top::after { display: block; top: -7px; left: calc(var(--at) - 7px); }
  .card.bottom::after { display: block; bottom: -7px; left: calc(var(--at) - 7px); }
  .stage {
    position: relative; flex: none; height: clamp(150px, 24vh, 190px); overflow: hidden;
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    background: radial-gradient(120% 90% at 50% 0%, color-mix(in srgb, var(--accent) 16%, var(--surface-2)), var(--surface-2));
    border-bottom: 1px solid var(--line);
  }
  /* The picture fades out at the bottom edge rather than being cut off. */
  .scene { position: absolute; inset: 0; mask-image: linear-gradient(to bottom, #000 70%, transparent); animation: scene 420ms cubic-bezier(0.2, 0.8, 0.2, 1) backwards; }
  .scene.fit { mask-image: none; }
  .scene.fit :global(.loop) { display: grid; align-content: center; }
  @keyframes scene { from { opacity: 0; transform: translateX(28px); } }
  .words { padding: var(--space-4) var(--space-4) 0; }
  .enter { animation: words 380ms ease-out 80ms backwards; }
  @keyframes words { from { opacity: 0; transform: translateY(6px); } }
  h2 { margin: 0; font-family: var(--font-headings); font-size: calc(var(--text-xl) * var(--size-headings)); line-height: 1.2; }
  .lead { margin: var(--space-2) 0 0; color: var(--text-2); font-size: calc(var(--text-base) * var(--size-app)); line-height: 1.45; }
  footer { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; padding: var(--space-3) var(--space-4) var(--space-3); }
  footer .go { justify-self: end; }
  /* Holds the row's height when the last card drops Skip this tour, so the card doesn't shift. */
  footer .skip { min-height: 44px; display: flex; align-items: center; }
  .dots { display: flex; align-items: center; }
  /* Each dot is a 44px-tall tap area with the small mark drawn in its middle, so a thumb can hit it. */
  .dot { display: grid; place-items: center; min-width: 18px; height: 44px; padding: 0 3px; border: 0; border-radius: 0; background: none; }
  .dot::before { content: ''; width: 8px; height: 8px; border-radius: 4px; background: var(--text-3); transition: width 300ms cubic-bezier(0.2, 0.8, 0.2, 1), background-color 300ms; }
  .dot.on::before { width: 20px; background: var(--accent); }
  .dot:focus-visible { outline: 2px solid var(--accent); outline-offset: -4px; border-radius: var(--radius-sm); }
  @media (prefers-reduced-motion: reduce) {
    .hole, .card.settled { transition: none; }
  }
</style>
