<script lang="ts">
  /**
   * Landing top section, "Into the thicket": deep forest green edge to edge,
   * dressed with fern fronds, the pitch on the left, and a real phone scrolling
   * through Everything on the right, tilted and lifted off the page. `below`
   * carries on inside the same green (one background, one set of fronds), so
   * there's no seam between it and the top.
   *
   * The greens are the brand's own and stay the same in every theme, like a
   * printed cover.
   */
  import type { Snippet } from 'svelte';
  import PhoneFeed from './PhoneFeed.svelte';
  import FrondFrame from './FrondFrame.svelte';

  let { pitch, below }: { pitch: Snippet; below?: Snippet } = $props();

  /* Where the headline and intro sit, measured whenever the section changes
     size, so the fronds can keep clear of them at any width. */
  let section = $state<HTMLElement>();
  let words = $state<HTMLElement>();
  let clear = $state<{ x: number; y: number; w: number; h: number } | null>(null);
  $effect(() => {
    if (!section || !words) return;
    const measure = () => {
      const s = section!.getBoundingClientRect();
      const boxes = [...words!.children].map((c) => c.getBoundingClientRect());
      const x = Math.min(...boxes.map((b) => b.left)), y = Math.min(...boxes.map((b) => b.top));
      const r = Math.max(...boxes.map((b) => b.right)), btm = Math.max(...boxes.map((b) => b.bottom));
      clear = { x: x - s.left, y: y - s.top, w: r - x, h: btm - y };
    };
    const ro = new ResizeObserver(measure);
    ro.observe(section);
    ro.observe(words);
    return () => ro.disconnect();
  });
</script>

<section class="forest" bind:this={section}>
  <FrondFrame {clear} />
  <div class="inner">
    <div class="pitch" bind:this={words}>{@render pitch()}</div>
    <div class="picture"><PhoneFeed /></div>
  </div>
  {#if below}<div class="below">{@render below()}</div>{/if}
</section>

<style>
  /* The page never scrolls sideways, so the green can run the full width of the window below. */
  :global(body:has(.forest)) { overflow-x: clip; }
  .forest {
    --forest: #1f3b29; --forest-deep: #15291c; --cream: #f6f1e8;
    --forest-ink-2: color-mix(in srgb, var(--cream) 80%, transparent);
    position: relative; color: var(--cream);
    /* Full width of the window, while what's inside keeps the page's column. */
    margin-inline: calc(50% - 50vw); padding-inline: calc(50vw - 50%);
    /* One continuous green: a glow behind the phone up top and another lower left, fading to the deep edges. */
    background:
      radial-gradient(60% 700px at 72% 380px, var(--forest), transparent),
      radial-gradient(60% 900px at 25% 85%, var(--forest), transparent),
      var(--forest-deep);
  }
  .inner {
    position: relative; display: grid; gap: var(--space-5); align-items: center;
    padding: calc(var(--space-6) + var(--space-3)) 0;
  }
  .pitch { min-width: 0; }
  /* A drop shadow lifts the words off the green and the leaves: a close, firm
     one under the letters and a wider, softer one below it. Near-black, since a
     softer shadow disappears on a background this dark. */
  .forest :global(h1) { color: var(--cream); text-shadow: 0 2px 3px rgba(0, 0, 0, 0.5), 0 6px 20px rgba(0, 0, 0, 0.6); }
  .forest :global(.sub) { color: color-mix(in srgb, var(--cream) 86%, transparent); text-shadow: 0 1px 2px rgba(0, 0, 0, 0.55), 0 3px 12px rgba(0, 0, 0, 0.6); }
  /* A highlighter pass over the first sentence, like a marked passage in the
     reader, in sage so it shows on the green. Each wrapped line gets its own band. */
  .forest :global(.sub mark) {
    color: inherit; background: color-mix(in srgb, color-mix(in srgb, #7fb08a 55%, #f6f1e8) 22%, transparent);
    border-radius: var(--radius-xs); padding: 0 0.15em;
    -webkit-box-decoration-break: clone; box-decoration-break: clone;
  }
  .picture { min-width: 0; }
  .below { position: relative; padding-bottom: var(--space-6); }
  @media (min-width: 820px) {
    /* The height it had with the phone beside the words, kept whatever sits there,
       so the headline lands in the same spot with the same room around it. */
    .inner { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: var(--space-6); padding: calc(var(--space-6) + var(--space-4)) 0; min-height: 794px; }
  }
</style>
