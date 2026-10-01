<script lang="ts">
  /**
   * The landing page's green top section, dressed with a couple dozen large fern
   * fronds, each placed on purpose: clustered in the corners, a few reaching in
   * behind the phone, none near the words. Nothing is random, so resizing the
   * window only slides the fronds along with the edge or the center they're
   * pinned to.
   *
   * Each frond is pinned to the left edge, the right edge, or the center of
   * the section, then given where its stem starts, which way it points, how
   * long it is, and which layer it sits in: very dark green furthest back,
   * then two strengths of the secondary green. Phones get their own list,
   * since there the words run across the top and the phone sits below.
   *
   * Decoration only: screen readers skip it and it can't be clicked.
   */
  type Layer = 'deep' | 'back' | 'front';
  /** `fromBottom`: `y` counts up from the bottom of the section instead of down from the top. */
  type Frond = { pin: 'left' | 'right' | 'center'; x: number; y: number; angle: number; length: number; bend: number; layer: Layer; fromBottom?: boolean };

  /*
   * The lower part of the green, where How it works and the sign-up area sit:
   * fronds only in the bottom corners and along the sides, clear of the
   * content in the middle. Only used when the section runs that tall.
   */
  const LOWER_WIDE: Frond[] = [
    { pin: 'left', x: -30, y: -20, angle: -40, length: 280, bend: -0.1, layer: 'back', fromBottom: true },
    { pin: 'left', x: -40, y: 120, angle: -12, length: 180, bend: 0.1, layer: 'front', fromBottom: true },
    { pin: 'left', x: -40, y: 560, angle: 10, length: 170, bend: -0.1, layer: 'deep', fromBottom: true },
    { pin: 'left', x: -30, y: 900, angle: -8, length: 150, bend: 0.1, layer: 'back', fromBottom: true },
    { pin: 'right', x: 30, y: -20, angle: 220, length: 280, bend: 0.1, layer: 'deep', fromBottom: true },
    { pin: 'right', x: 40, y: 110, angle: 195, length: 180, bend: -0.1, layer: 'front', fromBottom: true },
    { pin: 'right', x: 40, y: 600, angle: 175, length: 170, bend: 0.1, layer: 'back', fromBottom: true },
    { pin: 'right', x: 30, y: 950, angle: 188, length: 150, bend: -0.1, layer: 'deep', fromBottom: true }
  ];
  const LOWER_TALL: Frond[] = [
    { pin: 'left', x: -30, y: -20, angle: -40, length: 160, bend: -0.1, layer: 'deep', fromBottom: true },
    { pin: 'right', x: 30, y: -20, angle: 220, length: 160, bend: 0.1, layer: 'back', fromBottom: true }
  ];

  /* Laptop: the words sit 496px to 16px left of center, 273px to 520px down; the phone sits right of center. */
  const WIDE: Frond[] = [
    { pin: 'left', x: -30, y: 10, angle: 28, length: 400, bend: 0.12, layer: 'back' },
    { pin: 'left', x: -40, y: 150, angle: 8, length: 260, bend: -0.1, layer: 'deep' },
    { pin: 'left', x: -30, y: 800, angle: -30, length: 440, bend: -0.12, layer: 'back' },
    { pin: 'left', x: -20, y: 640, angle: -8, length: 250, bend: 0.1, layer: 'front' },
    { pin: 'center', x: -230, y: -20, angle: 96, length: 210, bend: 0.1, layer: 'front' },
    { pin: 'center', x: -260, y: 820, angle: -84, length: 230, bend: -0.1, layer: 'deep' },
    { pin: 'center', x: 90, y: -30, angle: 70, length: 360, bend: -0.12, layer: 'deep' },
    { pin: 'center', x: 180, y: 830, angle: -62, length: 520, bend: 0.1, layer: 'deep' },
    { pin: 'center', x: 420, y: 820, angle: -110, length: 400, bend: -0.1, layer: 'back' },
    { pin: 'right', x: 30, y: 20, angle: 155, length: 460, bend: -0.12, layer: 'back' },
    { pin: 'right', x: 40, y: 400, angle: 182, length: 380, bend: 0.1, layer: 'front' },
    { pin: 'right', x: 30, y: 800, angle: 208, length: 460, bend: 0.12, layer: 'deep' },
    /* Short ones along the left edge, beside the words but stopping short of them. */
    { pin: 'left', x: -30, y: 300, angle: -4, length: 130, bend: 0.1, layer: 'front' },
    { pin: 'left', x: -30, y: 470, angle: 6, length: 140, bend: -0.1, layer: 'back' },
    { pin: 'left', x: -40, y: -20, angle: 55, length: 300, bend: -0.1, layer: 'deep' },
    { pin: 'left', x: -40, y: 700, angle: -50, length: 320, bend: 0.1, layer: 'deep' },
    /* Hanging from the top and rising from the bottom, above and below the words. */
    { pin: 'center', x: -420, y: -30, angle: 88, length: 180, bend: 0.1, layer: 'back' },
    { pin: 'center', x: -80, y: -30, angle: 95, length: 220, bend: -0.1, layer: 'back' },
    { pin: 'center', x: -460, y: 820, angle: -95, length: 200, bend: 0.1, layer: 'front' },
    { pin: 'center', x: -60, y: 830, angle: -80, length: 260, bend: 0.12, layer: 'back' },
    /* More behind and around the phone. */
    { pin: 'center', x: 300, y: -30, angle: 110, length: 300, bend: 0.1, layer: 'back' },
    { pin: 'center', x: 560, y: -20, angle: 125, length: 380, bend: -0.1, layer: 'deep' },
    { pin: 'right', x: 40, y: 230, angle: 170, length: 320, bend: 0.12, layer: 'deep' },
    { pin: 'right', x: 40, y: 600, angle: 195, length: 340, bend: -0.1, layer: 'back' }
  ];

  /* Phone: the words run across the top 40px to 240px; the phone sits below. */
  const TALL: Frond[] = [
    { pin: 'left', x: -30, y: 320, angle: 10, length: 220, bend: 0.12, layer: 'back' },
    { pin: 'left', x: -30, y: 980, angle: -40, length: 360, bend: -0.12, layer: 'deep' },
    { pin: 'left', x: -20, y: 700, angle: -12, length: 200, bend: 0.1, layer: 'front' },
    { pin: 'right', x: 30, y: 360, angle: 172, length: 240, bend: -0.12, layer: 'back' },
    { pin: 'right', x: 30, y: 980, angle: 220, length: 380, bend: 0.12, layer: 'deep' },
    { pin: 'right', x: 20, y: 640, angle: 190, length: 200, bend: -0.1, layer: 'front' },
    { pin: 'center', x: 0, y: 1000, angle: -95, length: 420, bend: 0.08, layer: 'deep' },
    { pin: 'left', x: -30, y: 260, angle: 15, length: 130, bend: 0.1, layer: 'deep' },
    { pin: 'left', x: -30, y: 500, angle: 0, length: 170, bend: -0.1, layer: 'deep' },
    { pin: 'left', x: -30, y: 860, angle: -20, length: 240, bend: 0.1, layer: 'back' },
    { pin: 'right', x: 30, y: 500, angle: 180, length: 170, bend: 0.1, layer: 'deep' },
    { pin: 'right', x: 30, y: 850, angle: 200, length: 240, bend: -0.1, layer: 'back' },
    { pin: 'center', x: -120, y: 1000, angle: -80, length: 300, bend: -0.1, layer: 'back' },
    { pin: 'center', x: 130, y: 1000, angle: -100, length: 300, bend: 0.1, layer: 'front' }
  ];

  let w = $state(0);
  let h = $state(0);

  const r = (n: number) => Math.round(n);

  /**
   * One frond: a gently curved stem with pairs of leaflets along it. Leaflets
   * start small at the base, are longest about a third of the way up, and
   * taper to the tip, each sweeping forward toward the tip.
   */
  function frond(f: Frond, width: number, height: number) {
    const baseX = f.pin === 'left' ? f.x : f.pin === 'right' ? width + f.x : width / 2 + f.x;
    let angle = (f.angle * Math.PI) / 180;
    const steps = 44, step = f.length / steps;
    let x = baseX, y = f.fromBottom ? height - f.y : f.y;
    const stem = [`M${r(x)} ${r(y)}`];
    const leaves: string[] = [];
    for (let i = 1; i <= steps; i++) {
      angle += (f.bend * 2) / steps;
      x += Math.cos(angle) * step; y += Math.sin(angle) * step;
      stem.push(`L${r(x)} ${r(y)}`);
      if (i % 2 || i < 3) continue;
      const t = i / steps;
      /* Grows quickly from the base, then tapers steadily, still a fifth of its longest at the tip. */
      const size = f.length * 0.2 * Math.min(1, t * 3.5) * (1 - t * 0.8) + 4;
      for (const side of [-1, 1]) {
        const a = angle + side * 1.0;
        const cx = Math.cos(a), cy = Math.sin(a), bulge = size * 0.22;
        const tx = x + cx * size, ty = y + cy * size;
        const mx = x + cx * size * 0.5, my = y + cy * size * 0.5;
        leaves.push(`M${r(x)} ${r(y)}Q${r(mx - cy * bulge)} ${r(my + cx * bulge)} ${r(tx)} ${r(ty)}Q${r(mx + cy * bulge)} ${r(my - cx * bulge)} ${r(x)} ${r(y)}Z`);
      }
    }
    return { stem: stem.join(''), leaves: leaves.join('') };
  }

  /*
   * Fronds that spill past the section's edge into the cream around it, so
   * the green seems to grow into the page instead of stopping at a straight
   * line. Rooted just inside the edge; sage only, since the near-black reads
   * harshly on cream. The "How it works" panel sits above them, so some tuck
   * behind its corners.
   */
  const SPILL: { wide: Frond[]; tall: Frond[] } = {
    wide: [{ pin: 'right', x: -90, y: 40, angle: 95, length: 180, bend: -0.1, layer: 'back', fromBottom: true }],
    tall: []
  };

  function draw(list: Frond[]) {
    const out: Record<Layer, { stems: string; leaves: string }> = { deep: { stems: '', leaves: '' }, back: { stems: '', leaves: '' }, front: { stems: '', leaves: '' } };
    for (const f of list) {
      const d = frond(f, w, h);
      out[f.layer].stems += d.stem;
      out[f.layer].leaves += d.leaves;
    }
    return out;
  }

  const drawn = $derived.by(() => {
    if (!w || !h) return null;
    const wide = w >= 820;
    /* Taller than the top section alone: the green carries on below, so dress its lower part too. */
    const lower = h > (wide ? 1100 : 1300) ? (wide ? LOWER_WIDE : LOWER_TALL) : [];
    return draw([...(wide ? WIDE : TALL), ...lower]);
  });
  const spilled = $derived.by(() => (w && h ? draw(w >= 820 ? SPILL.wide : SPILL.tall) : null));
</script>

<div class="frame" bind:clientWidth={w} bind:clientHeight={h} aria-hidden="true">
  {#if drawn}
    <svg width={w} height={h} viewBox="0 0 {w} {h}">
      {#each ['deep', 'back', 'front'] as const as layer (layer)}
        <g class={layer}><path class="stem" d={drawn[layer].stems} /><path class="leaf" d={drawn[layer].leaves} /></g>
      {/each}
    </svg>
  {/if}
</div>
{#if spilled}
  <svg class="spill" width={w} height={h} viewBox="0 0 {w} {h}" aria-hidden="true">
    {#each ['back', 'front'] as const as layer (layer)}
      <g class={layer}><path class="stem" d={spilled[layer].stems} /><path class="leaf" d={spilled[layer].leaves} /></g>
    {/each}
  </svg>
{/if}

<style>
  .frame { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
  svg { display: block; }
  /* Drawn over the section's full area but free to run past its edges. */
  .spill { position: absolute; inset: 0; pointer-events: none; overflow: visible; }
  /* The secondary green: the soft sage thicket uses for its dark-mode accent. */
  g { --leaf: #7fb08a; }
  /* Furthest back: a green darker than the section itself, for shadowy depth. */
  .deep { --leaf: #0c1b11; }
  .back { opacity: 0.3; }
  .front { opacity: 0.6; }
  .stem { fill: none; stroke: var(--leaf); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  .leaf { fill: var(--leaf); }
</style>
