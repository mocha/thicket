<script lang="ts">
  /**
   * The landing page's picture: a phone scrolling through Everything on its
   * own. The posts are real and current, the newest few from the first three
   * collections on Explore, mixed newest first the way Everything mixes them.
   * They're drawn with the real article card, so the picture can't drift from
   * the app.
   *
   * It's a picture, not a control: nothing inside can be tapped or tabbed to,
   * and screen readers skip it. It moves one post at a time with a pause
   * between, like a person reading, and loops without a visible seam because
   * the list is drawn twice. With reduced motion on, it holds still.
   */
  import { onMount } from 'svelte';
  import type { RiverItem } from '$lib/api';
  import { showcasePosts } from '$lib/showcase';
  import ItemCard from './ItemCard.svelte';
  import Button from './Button.svelte';

  /* The phone's tab bar, drawn like the app's own on a phone. Same glyphs as the real one. */
  const tabs = [
    { label: 'Everything', d: 'M4 12c3-3 5-3 8 0s5 3 8 0M4 17c3-3 5-3 8 0s5 3 8 0M4 7c3-3 5-3 8 0s5 3 8 0', on: true },
    { label: 'Collections', d: 'M4 6h16M4 12h16M4 18h10' },
    { label: 'Bookmarks', d: 'M6 4h12v17l-6-4-6 4z' },
    { label: 'Explore', d: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM15.5 8.5l-2 5-5 2 2-5z' }
  ];

  let items = $state<RiverItem[]>([]);
  let track = $state<HTMLElement | null>(null);

  onMount(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    showcasePosts(8).then((p) => (items = p)).catch(() => {});

    const still = window.matchMedia('(prefers-reduced-motion: reduce)');
    let index = 0;
    let at = 0;

    function step() {
      if (stopped) return;
      const cards = track ? Array.from(track.children) as HTMLElement[] : [];
      const n = cards.length / 2;
      if (!track || n < 2 || still.matches || document.hidden) { timer = setTimeout(step, 1000); return; }
      index += 1;
      const to = cards[index].offsetTop - cards[0].offsetTop;
      const move = track.animate([{ transform: `translateY(${-at}px)` }, { transform: `translateY(${-to}px)` }], { duration: 900, easing: 'cubic-bezier(.4, 0, .2, 1)', fill: 'forwards' });
      at = to;
      move.onfinish = () => {
        // A full lap: the second copy now sits where the first began, so jump back unseen.
        if (index >= n && track) { index = 0; at = 0; track.getAnimations().forEach((a) => a.cancel()); track.style.transform = 'translateY(0)'; }
        timer = setTimeout(step, 2200);
      };
    }
    timer = setTimeout(step, 2200);

    return () => { stopped = true; clearTimeout(timer); };
  });
</script>

<div class="stage" aria-hidden="true">
  <div class="phone">
    <div class="screen" inert>
      <div class="status"><span>9:41</span><span class="island"></span></div>
      <div class="bar">
        <div class="titlerow"><span class="brand"><img src="/icon.svg" alt="" width="22" height="22" />thicket</span><Button variant="primary" solid size="sm"><span aria-hidden="true">+</span> Add new feed</Button></div>
      </div>
      <div class="viewport">
        <ol class="track" bind:this={track}>
          {#each [0, 1] as copy (copy)}
            {#each items as item (`${copy}-${item.id}`)}<li><ItemCard {item} /></li>{/each}
          {/each}
        </ol>
      </div>
      <div class="tabs">
        {#each tabs as t (t.label)}
          <span class="tab" class:on={t.on}><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d={t.d} /></svg>{t.label}</span>
        {/each}
      </div>
    </div>
  </div>
</div>

<style>
  /* The phone is drawn as a physical object: tilted clockwise, top toward
     the right, and lifted off the page by a long soft shadow, with a metal edge,
     the pill-shaped camera cutout, side buttons, and a faint glare. Its
     near-black body and those shadows are the drawing of hardware, not
     interface, so they stay the same in every theme, the way a real phone does. */
  .stage { position: relative; display: grid; place-items: center; padding: var(--space-5) 0; }
  .phone {
    position: relative; width: 320px; height: 650px; padding: 11px; border-radius: 56px;
    background: linear-gradient(150deg, #5b5d60 0%, #1b1c1e 18%, #0c0c0d 55%, #2a2b2e 100%);
    box-shadow:
      inset 0 0 0 1.5px rgba(255, 255, 255, 0.18),
      inset 0 0 0 5px #0a0a0b,
      24px 44px 70px rgba(0, 0, 0, 0.38),
      6px 14px 22px rgba(0, 0, 0, 0.28);
    transform: rotate(8deg);
  }
  /* Volume and power buttons along the edges. */
  .phone::before, .phone::after { content: ''; position: absolute; width: 4px; border-radius: 2px; background: #2c2d30; }
  .phone::before { left: -3px; top: 150px; height: 90px; box-shadow: 0 -52px 0 -12px #2c2d30; }
  .phone::after { right: -3px; top: 190px; height: 110px; }
  .screen { position: relative; height: 100%; border-radius: 44px; overflow: hidden; background: var(--bg); color: var(--text); display: flex; flex-direction: column; }
  /* A faint diagonal glare across the glass. */
  .screen::after { content: ''; position: absolute; inset: 0; pointer-events: none; background: linear-gradient(115deg, rgba(255, 255, 255, 0.22) 0%, rgba(255, 255, 255, 0) 38%); }
  .status { flex: none; position: relative; height: 44px; display: flex; align-items: center; padding: 0 28px; font-size: calc(var(--text-sm) * var(--size-app)); font-weight: 600; }
  .island { position: absolute; top: 11px; left: 50%; transform: translateX(-50%); width: 92px; height: 26px; border-radius: var(--radius-pill); background: #050505; }
  .bar { flex: none; padding: var(--space-1) var(--space-4) var(--space-3); }
  .titlerow { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); }
  /* The app's own name at the top, set like the logo in the page header. */
  .brand { display: flex; align-items: center; gap: var(--space-2); font-weight: 700; font-size: calc(var(--text-lg) * var(--size-app)); letter-spacing: -0.01em; }
  /* Like the app's bottom bar on a phone; its labels are the one place the app goes below 12px. */
  .tabs { flex: none; display: flex; padding: var(--space-2) var(--space-1) var(--space-4); border-top: 1px solid var(--line); background: var(--surface); }
  .tab { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px; font-size: 10px; color: var(--text-3); }
  .tab.on { color: var(--accent); }
  .viewport { flex: 1; min-height: 0; overflow: hidden; padding: 0 var(--space-3); }
  .track { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-3); will-change: transform; }
  @media (max-width: 819px) { .phone { width: 290px; height: 590px; transform: rotate(6deg); } }
</style>
