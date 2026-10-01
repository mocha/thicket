<script lang="ts">
  /**
   * The landing page's green, dressed with Christie's hand-drawn fronds (see
   * $lib/fronds), each placed on purpose: clustered in the corners, a few reaching in
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
  import { HAND_FRONDS, LONG_FRONDS, SHORT_FRONDS } from '$lib/fronds';

  /** `clear`: where the headline and intro sit in the section; no frond reaches into it. */
  let { clear = null }: { clear?: { x: number; y: number; w: number; h: number } | null } = $props();

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
    { pin: 'right', x: 30, y: -20, angle: 220, length: 280, bend: 0.1, layer: 'deep', fromBottom: true },
    { pin: 'right', x: 40, y: 110, angle: 195, length: 180, bend: -0.1, layer: 'front', fromBottom: true }
  ];

  /*
   * Down both sides of the lower green, one frond every so often, reaching
   * into the space beside the content and no further. The angles, curves,
   * and layers repeat in a fixed pattern (nothing random), kept within a
   * narrow range so neighbors don't cross. The right side mirrors the left,
   * shifted half a step so the two sides don't line up.
   */
  const SIDE = [
    { angle: -12, bend: 0.1, layer: 'back', reach: 1 },
    { angle: 14, bend: -0.1, layer: 'deep', reach: 1.5 },
    { angle: -4, bend: -0.08, layer: 'front', reach: 0.7 },
    { angle: 8, bend: 0.1, layer: 'deep', reach: 1.3 },
    { angle: -16, bend: 0.08, layer: 'back', reach: 0.85 },
    { angle: 4, bend: -0.1, layer: 'front', reach: 0.6 }
  ] as const;
  /** Where the hero ends and the side fronds begin, and the room between them. */
  const SIDE_FROM = 900, SIDE_STEP = 170;
  /*
   * A few long fronds reaching in behind the How it works panel, which is
   * frosted, so they show through it softly.
   */
  const BEHIND_PANEL: Frond[] = [
    { pin: 'left', x: -40, y: 1010, angle: 6, length: 520, bend: -0.08, layer: 'deep' },
    { pin: 'right', x: 40, y: 1240, angle: 176, length: 540, bend: 0.08, layer: 'deep' },
    { pin: 'left', x: -40, y: 1330, angle: -6, length: 420, bend: 0.08, layer: 'back' },
    { pin: 'right', x: 40, y: 960, angle: 184, length: 400, bend: -0.08, layer: 'back' }
  ];

  function sides(width: number, height: number): Frond[] {
    /* The space beside the page's content column. The pale fronds stop short of
       the content; only the darkest ones reach a little way behind it. */
    const gutter = Math.max(0, (width - 992) / 2);
    const base = Math.min(300, Math.max(100, gutter + 10));
    const out: Frond[] = [];
    let i = 0;
    for (let y = SIDE_FROM; y < height - 260; y += SIDE_STEP, i++) {
      const p = SIDE[i % SIDE.length];
      const q = SIDE[(i + 3) % SIDE.length];
      out.push({ pin: 'left', x: -40, y, angle: p.angle, length: base * p.reach, bend: p.bend, layer: p.layer });
      if (y + SIDE_STEP / 2 < height - 260) out.push({ pin: 'right', x: 40, y: y + SIDE_STEP / 2, angle: 180 - q.angle, length: base * q.reach, bend: -q.bend, layer: q.layer });
    }
    return out;
  }

  const LOWER_TALL: Frond[] = [
    { pin: 'left', x: -30, y: -20, angle: -40, length: 160, bend: -0.1, layer: 'deep', fromBottom: true },
    { pin: 'right', x: 30, y: -20, angle: 220, length: 160, bend: 0.1, layer: 'back', fromBottom: true }
  ];

  /* Laptop: the words sit 496px to 16px left of center, 273px to 520px down; the phone sits right of center. */
  const WIDE: Frond[] = [
    { pin: 'left', x: -30, y: 10, angle: 28, length: 400, bend: 0.12, layer: 'back' },
    { pin: 'left', x: -40, y: 150, angle: 8, length: 260, bend: -0.1, layer: 'deep' },
    /* The bottom-left corner fans out: the higher a frond starts, the more it points up, so none cross. */
    { pin: 'left', x: -30, y: 820, angle: -14, length: 440, bend: -0.06, layer: 'back' },
    { pin: 'left', x: -20, y: 680, angle: -30, length: 230, bend: 0.06, layer: 'front' },
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
    { pin: 'left', x: -40, y: 760, angle: -22, length: 320, bend: 0.06, layer: 'deep' },
    /* Hanging from the top and rising from the bottom, above and below the words. */
    { pin: 'center', x: -420, y: -30, angle: 88, length: 180, bend: 0.1, layer: 'back' },
    { pin: 'center', x: -80, y: -30, angle: 95, length: 220, bend: -0.1, layer: 'back' },
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


  const fronds = $derived.by(() => {
    if (!w || !h) return null;
    const wide = w >= 820;
    /* Taller than the top section alone: the green carries on below, so dress its lower part too. */
    const lower = h > (wide ? 1100 : 1300) ? (wide ? [...LOWER_WIDE, ...BEHIND_PANEL, ...sides(w, h)] : LOWER_TALL) : [];
    return [...(wide ? WIDE : TALL), ...lower].map((f) => fit(f, w, h)).filter((f) => f !== null);
  });
  /*
   * Keeps the words clear at any window size: a frond that would reach into
   * the space around the headline and intro is cut short before it gets
   * there, and one left too short to read as a frond is dropped. Checked
   * along the frond's length, allowing for how wide its leaves spread.
   */
  const MARGIN = 28;
  function fit(f: Frond, width: number, height: number): Frond | null {
    if (!clear) return f;
    const x0 = f.pin === 'left' ? f.x : f.pin === 'right' ? width + f.x : width / 2 + f.x;
    const y0 = f.fromBottom ? height - f.y : f.y;
    const a = (f.angle * Math.PI) / 180, spread = 0.3;
    const left = clear.x - MARGIN, right = clear.x + clear.w + MARGIN, top = clear.y - MARGIN, bottom = clear.y + clear.h + MARGIN;
    for (let i = 1; i <= 30; i++) {
      const t = (f.length * i) / 30;
      const px = x0 + Math.cos(a) * t, py = y0 + Math.sin(a) * t;
      // The leaves' spread grows with the frond, so a shorter frond is narrower too.
      const reach = spread * t;
      const dx = Math.max(left - px, 0, px - right), dy = Math.max(top - py, 0, py - bottom);
      if (Math.hypot(dx, dy) < reach || (dx === 0 && dy === 0)) {
        const length = (f.length * (i - 1)) / 30 * 0.9;
        return length < 90 ? null : { ...f, length };
      }
    }
    return f;
  }

  /*
   * Each frond's drawing, placed by its entry in the lists above: its base on
   * the frond's starting point, turned to the frond's angle, scaled to its
   * length. Short fronds get the short, full drawing; the long drawings take
   * turns on the rest. One drawn tip-left is flipped to point
   * away from its base; fronds that curve the other way are mirrored, so
   * they don't all match.
   */
  function placeHand(f: Frond, i: number) {
    const pool = f.length < 230 ? SHORT_FRONDS : LONG_FRONDS;
    const d = pool[i % pool.length];
    const x = f.pin === 'left' ? f.x : f.pin === 'right' ? w + f.x : w / 2 + f.x;
    const y = f.fromBottom ? h - f.y : f.y;
    const s = f.length / d.reach;
    const flip = d.base.x > d.width / 2 ? -1 : 1;
    const mirror = f.bend < 0 ? -1 : 1;
    return { id: `frond-${HAND_FRONDS.indexOf(d)}`, transform: `translate(${r(x)} ${r(y)}) rotate(${f.angle}) scale(${s * flip} ${s * mirror}) translate(${-d.base.x} ${-d.base.y})` };
  }
</script>

<div class="frame" bind:clientWidth={w} bind:clientHeight={h} aria-hidden="true">
  {#if fronds}
    <svg width={w} height={h} viewBox="0 0 {w} {h}">
      <defs>
        {#each HAND_FRONDS as d, n (n)}
          <symbol id="frond-{n}" viewBox="0 0 {d.width} {d.height}" width={d.width} height={d.height} overflow="visible">
            <path class="h-shape" d={d.shape} />
            <path class="h-shadow" d={d.shadow} />
            <path class="h-veins" d={d.veins} />
          </symbol>
        {/each}
      </defs>
      {#each ['deep', 'back', 'front'] as const as layer (layer)}
        <g class={layer}>
          {#each fronds.map((f, i) => [f, i] as const).filter(([f]) => f.layer === layer) as [f, i] (i)}
            {@const p = placeHand(f, i)}<use href="#{p.id}" transform={p.transform} />
          {/each}
        </g>
      {/each}
    </svg>
  {/if}
</div>

<style>
  .frame { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
  svg { display: block; }
  /* The secondary green: the soft sage thicket uses for its dark-mode accent. */
  g { --leaf: #7fb08a; }
  /* Furthest back: a green darker than the section itself, for shadowy depth. */
  .deep { --leaf: #0c1b11; }
  .back { opacity: 0.3; }
  .front { opacity: 0.6; }
  /* Each frond: the silhouette in the layer's green, its shadows a
     shade darker, its veins a shade lighter. */
  .h-shape { fill: var(--leaf); }
  .h-shadow { fill: color-mix(in srgb, var(--leaf) 62%, #0c1b11); }
  .h-veins { fill: var(--vein); }
  /* Colors reach the drawing only through these settings, set on each layer. */
  g { --vein: color-mix(in srgb, #7fb08a 55%, #f6f1e8); }
  .deep { --vein: color-mix(in srgb, #0c1b11 80%, #7fb08a); }
</style>
