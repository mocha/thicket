<script lang="ts">
  /**
   * Landing top section, "Papers on the table": the pitch and the sign-up box
   * centered on a soft wash of the accent color, with today's real posts
   * scattered around them at slight angles like papers on a table, each
   * drifting a little. They're drawn with the real article card, pictures
   * included, and only posts with a picture are used.
   *
   * The cards are a picture, not controls: nothing in them can be tapped or
   * tabbed to, and screen readers skip them. On narrow screens they're left
   * out, since there's no room beside the text.
   */
  import { onMount, type Snippet } from 'svelte';
  import type { RiverItem } from '$lib/api';
  import { showcasePosts } from '$lib/showcase';
  import ItemCard from './ItemCard.svelte';

  let { pitch }: { pitch: Snippet } = $props();
  let items = $state<RiverItem[]>([]);

  onMount(() => { showcasePosts(4, { pictures: true }).then((p) => (items = p)).catch(() => {}); });

  /* Two spots down each side, reaching past the page's column into the margins:
     where the card sits and how far it's turned. */
  const spots = [
    { side: 'left', x: '-9%', y: '6%', turn: -7 },
    { side: 'right', x: '-7%', y: '12%', turn: 6 },
    { side: 'left', x: '1%', y: '52%', turn: 4 },
    { side: 'right', x: '0%', y: '56%', turn: -4 }
  ];
</script>

<section class="table">
  <div class="scatter" aria-hidden="true" inert>
    {#each items as item, i (item.id)}
      {@const s = spots[i]}
      <div class="paper" style="{s.side}: {s.x}; top: {s.y}; --turn: {s.turn}deg; animation-delay: -{i * 1.3}s"><ItemCard {item} /></div>
    {/each}
  </div>
  <div class="pitch">{@render pitch()}</div>
</section>

<style>
  .table {
    position: relative; display: grid; justify-items: center; align-content: center; text-align: center; min-height: 640px;
    padding: var(--space-6) 0;
    /* A wash of the accent fading into the page, edge to edge. Drawn as a border
       image pushed out past both sides: it paints the full width of the window
       but, unlike a wider box, can't make the page scroll sideways. */
    border-image: linear-gradient(180deg, color-mix(in srgb, var(--accent) 22%, var(--bg)), var(--bg)) fill 0 / 0 / 0 100vw;
  }
  .pitch { position: relative; z-index: 1; max-width: 30rem; display: flex; flex-direction: column; align-items: center; }
  .pitch :global(.sub) { margin-inline: auto; }
  .scatter { display: none; }
  .paper {
    position: absolute; width: 220px; text-align: left;
    transform: rotate(var(--turn)); animation: drift 8s ease-in-out infinite alternate;
    filter: drop-shadow(0 18px 24px rgba(0, 0, 0, 0.14));
    --summary-lines: 0;
  }
  .paper :global(.card-summary) { display: none; }
  .paper :global(.card-title) { --title-lines: 3; font-size: calc(var(--text-base) * var(--size-headings)); }
  .paper :global(.card-extralink), .paper :global(footer) { display: none; }
  @keyframes drift {
    from { transform: translateY(0) rotate(var(--turn)); }
    to { transform: translateY(-12px) rotate(calc(var(--turn) + 1.5deg)); }
  }
  @media (prefers-reduced-motion: reduce) { .paper { animation: none; } }
  @media (min-width: 1000px) { .scatter { display: block; position: absolute; inset: 0; } }
</style>
