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
  import { api, exploreApi, type RiverItem } from '$lib/api';
  import ItemCard from './ItemCard.svelte';

  let items = $state<RiverItem[]>([]);
  let track = $state<HTMLElement | null>(null);

  onMount(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    exploreApi.featured()
      .then((r) => Promise.all(r.collections.slice(0, 3).map((c) => api.river({ collection: c.id, limit: 4 }).catch(() => null))))
      .then((pages) => {
        const all = pages.flatMap((p) => p?.items ?? []);
        const seen = new Set<number>();
        items = all
          .filter((i) => !seen.has(i.id) && seen.add(i.id))
          .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
          .slice(0, 8);
      })
      .catch(() => {});

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
      <div class="bar"><span class="title">Everything</span></div>
      <div class="viewport">
        <ol class="track" bind:this={track}>
          {#each [0, 1] as copy (copy)}
            {#each items as item (`${copy}-${item.id}`)}<li><ItemCard {item} /></li>{/each}
          {/each}
        </ol>
      </div>
    </div>
  </div>
</div>

<style>
  /* A soft pool of the accent behind the phone, so it sits in the page rather than on it. */
  .stage { position: relative; display: grid; place-items: center; padding: var(--space-5) 0; }
  .stage::before { content: ''; position: absolute; inset: 0; background: radial-gradient(closest-side, var(--accent-soft), transparent); }
  /* The hardware. Its size and the near-black body are the drawing of a phone,
     not interface: they stay the same in every theme, the way a real phone does. */
  .phone {
    position: relative; width: 300px; height: 600px; padding: 10px;
    background: #141414; border-radius: 48px; box-shadow: var(--shadow-dialog);
  }
  .screen { height: 100%; border-radius: 38px; overflow: hidden; background: var(--bg); display: flex; flex-direction: column; }
  .bar { flex: none; padding: var(--space-6) var(--space-4) var(--space-2); }
  .title { font-family: var(--font-headings); font-weight: 700; font-size: calc(var(--text-xl) * var(--size-headings)); }
  .viewport { flex: 1; min-height: 0; overflow: hidden; padding: 0 var(--space-3); }
  .track { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-3); will-change: transform; }
  @media (max-width: 819px) { .phone { width: 270px; height: 520px; } }
</style>
