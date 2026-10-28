<script lang="ts">
  /**
   * Setup's welcome, dressed the way the landing page was: the forest green,
   * with Christie's hand-drawn fronds wound around the border like a wreath,
   * each growing from a corner along its edge, never crossing, in three
   * depths: very dark green furthest back, then two strengths of the soft
   * sage. The questions sit on a panel in the middle, in the theme's own
   * surface color.
   *
   * The landing page's own colors, not the theme's: this is the one branded
   * moment in setup, and the green reads the same in light and dark. Nothing
   * is random, so every window gets the same arrangement, pinned to its edges.
   * Loaded only when the welcome opens, since the drawings are large.
   * Decoration only: screen readers skip it and it can't be clicked.
   */
  import { FROND_1, FROND_2, FROND_3, FROND_4, type HandFrond } from '$lib/fronds';

  type Layer = 'deep' | 'back' | 'front';
  /**
   * Each frond runs along the border rather than into it, so the whole of it
   * shows: its stem starts near a corner, in the middle of the border, and it
   * grows along the edge toward the middle of that side. Its stem starts at
   * x and y, shares of the window's width and height, nudged by dx and dy
   * pixels into the border; angle 0 points right, 90 down; length is a share
   * of the side named by `along`; curl is which side its leaves lean to.
   */
  type Frond = { x: number; dx: number; y: number; dy: number; angle: number; along: 'w' | 'h'; length: number; curl: 1 | -1; layer: Layer };

  const FRONDS: Frond[] = [
    /* Furthest back, darkest: one tucked into each corner, and one lying along the middle of each side. */
    { x: 0, dx: -10, y: 0, dy: -10, angle: 45, along: 'h', length: 0.42, curl: 1, layer: 'deep' },
    { x: 1, dx: 10, y: 0, dy: -10, angle: 135, along: 'h', length: 0.42, curl: -1, layer: 'deep' },
    { x: 0, dx: -10, y: 1, dy: 10, angle: -45, along: 'h', length: 0.42, curl: -1, layer: 'deep' },
    { x: 1, dx: 10, y: 1, dy: 10, angle: -135, along: 'h', length: 0.42, curl: 1, layer: 'deep' },
    { x: 0.5, dx: 0, y: 0, dy: 30, angle: 180, along: 'w', length: 0.3, curl: 1, layer: 'deep' },
    { x: 0.5, dx: 0, y: 1, dy: -30, angle: 0, along: 'w', length: 0.3, curl: 1, layer: 'deep' },
    { x: 0, dx: 34, y: 0.5, dy: 0, angle: -90, along: 'h', length: 0.3, curl: 1, layer: 'deep' },
    { x: 1, dx: -34, y: 0.5, dy: 0, angle: 90, along: 'h', length: 0.3, curl: 1, layer: 'deep' },
    /* Along the top and bottom, from each corner toward the middle. */
    { x: 0, dx: -16, y: 0, dy: 30, angle: 3, along: 'w', length: 0.44, curl: 1, layer: 'front' },
    { x: 1, dx: 16, y: 0, dy: 26, angle: 177, along: 'w', length: 0.4, curl: -1, layer: 'back' },
    { x: 0, dx: -16, y: 1, dy: -26, angle: -3, along: 'w', length: 0.4, curl: -1, layer: 'back' },
    { x: 1, dx: 16, y: 1, dy: -30, angle: 183, along: 'w', length: 0.44, curl: 1, layer: 'front' },
    /* Down and up the sides, from each corner toward the middle. */
    { x: 0, dx: 36, y: 0, dy: -16, angle: 87, along: 'h', length: 0.46, curl: -1, layer: 'back' },
    { x: 1, dx: -36, y: 0, dy: -16, angle: 93, along: 'h', length: 0.48, curl: 1, layer: 'front' },
    { x: 0, dx: 36, y: 1, dy: 16, angle: -87, along: 'h', length: 0.48, curl: 1, layer: 'front' },
    { x: 1, dx: -36, y: 1, dy: 16, angle: -93, along: 'h', length: 0.46, curl: -1, layer: 'back' }
  ];
  const DRAWINGS = [FROND_1, FROND_2, FROND_3, FROND_4];

  let w = $state(0);
  let h = $state(0);

  /** Where a frond's stem starts, its drawing turned to point its way and scaled to its length. */
  function place(f: Frond, i: number) {
    const d: HandFrond = DRAWINGS[i % DRAWINGS.length];
    const s = (f.length * (f.along === 'w' ? w : h)) / d.reach;
    // A drawing whose stem is on its right points left: flip it so every one points away from its stem.
    const flip = d.base.x > d.width / 2 ? -1 : 1;
    return { d: i % DRAWINGS.length, transform: `translate(${(f.x * w + f.dx).toFixed(1)} ${(f.y * h + f.dy).toFixed(1)}) rotate(${f.angle}) scale(${(s * flip).toFixed(4)} ${(s * f.curl).toFixed(4)}) translate(${-d.base.x} ${-d.base.y})` };
  }
</script>

<div class="forest" bind:clientWidth={w} bind:clientHeight={h} aria-hidden="true">
  {#if w && h}
    <svg width={w} height={h} viewBox="0 0 {w} {h}">
      <defs>
        {#each DRAWINGS as d, n (n)}
          <symbol id="welcome-frond-{n}" viewBox="0 0 {d.width} {d.height}" width={d.width} height={d.height} overflow="visible">
            <path class="shape" d={d.shape} />
            <path class="shadow" d={d.shadow} />
            <path class="veins" d={d.veins} />
          </symbol>
        {/each}
      </defs>
      {#each ['deep', 'back', 'front'] as const as layer (layer)}
        <g class={layer}>
          {#each FRONDS.map((f, i) => [f, i] as const).filter(([f]) => f.layer === layer) as [f, i] (i)}
            {@const p = place(f, i)}<use href="#welcome-frond-{p.d}" transform={p.transform} />
          {/each}
        </g>
      {/each}
    </svg>
  {/if}
</div>

<style>
  .forest {
    --forest: #1f3b29; --forest-deep: #15291c; --sage: #7fb08a; --cream: #f6f1e8;
    position: absolute; inset: 0; overflow: hidden; border-radius: inherit; pointer-events: none;
    background:
      radial-gradient(70% 90% at 75% 20%, var(--forest), transparent),
      radial-gradient(70% 90% at 20% 90%, var(--forest), transparent),
      var(--forest-deep);
  }
  svg { display: block; }
  /* The soft sage in front, the darkest green furthest back. */
  g { --leaf: var(--sage); --vein: color-mix(in srgb, var(--sage) 55%, var(--cream)); }
  .deep { --leaf: #0c1b11; --vein: color-mix(in srgb, #0c1b11 80%, var(--sage)); }
  .back { opacity: 0.3; }
  .front { opacity: 0.6; }
  .shape { fill: var(--leaf); }
  .shadow { fill: color-mix(in srgb, var(--leaf) 62%, #0c1b11); }
  .veins { fill: var(--vein); }
</style>
