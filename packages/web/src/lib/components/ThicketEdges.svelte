<script lang="ts">
  /**
   * The earlier thicket: sprigs of leaves growing in from all four edges of
   * the landing page's green top section, thicker in the corners, in two
   * layers of the secondary green. Generated to fit the section, with a fixed
   * seed. It holds still. TEMPORARY: kept for comparison with the fronds.
   */
  let w = $state(0);
  let h = $state(0);

  function seeded(seed: number) {
    return () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
  }

  type Leaf = { x: number; y: number; angle: number; length: number; width: number };
  type Sprig = { x1: number; y1: number; x2: number; y2: number; leaves: Leaf[]; back: boolean };

  function grow(width: number, height: number): Sprig[] {
    const rand = seeded(7);
    const sprigs: Sprig[] = [];
    const reachSide = Math.min(110, width * 0.09);
    const reachEnd = Math.min(80, height * 0.12);

    function sprig(x: number, y: number, inward: number, reach: number, back: boolean) {
      const angle = inward + (rand() - 0.5) * 1.1;
      const length = reach * (0.55 + rand() * 0.6) * (back ? 1.25 : 1);
      const x2 = x + Math.cos(angle) * length;
      const y2 = y + Math.sin(angle) * length;
      const leaves: Leaf[] = [];
      const count = 3 + Math.floor(rand() * 4);
      for (let i = 1; i <= count; i++) {
        const t = i / (count + 0.6);
        const size = (back ? 22 : 16) * (1.1 - t * 0.5) * (0.8 + rand() * 0.4);
        for (const turn of [-1, 1]) {
          if (rand() < 0.15) continue;
          leaves.push({ x: x + (x2 - x) * t, y: y + (y2 - y) * t, angle: (angle * 180) / Math.PI + turn * (38 + rand() * 22), length: size, width: size * 0.42 });
        }
      }
      leaves.push({ x: x2, y: y2, angle: (angle * 180) / Math.PI, length: back ? 20 : 15, width: back ? 8 : 6 });
      sprigs.push({ x1: x, y1: y, x2, y2, leaves, back });
    }

    function edge(from: [number, number], to: [number, number], inward: number, reach: number) {
      const span = Math.hypot(to[0] - from[0], to[1] - from[1]);
      let d = -10;
      while (d < span + 10) {
        const t = d / span;
        const corner = Math.min(t, 1 - t);
        const x = from[0] + (to[0] - from[0]) * t;
        const y = from[1] + (to[1] - from[1]) * t;
        const boost = corner < 0.12 ? 1.5 : 1;
        sprig(x, y, inward, reach * boost, true);
        if (rand() < 0.8) sprig(x + (rand() - 0.5) * 20, y + (rand() - 0.5) * 20, inward, reach * boost * 0.8, false);
        d += (corner < 0.12 ? 22 : 38) + rand() * 26;
      }
    }

    edge([0, -6], [width, -6], Math.PI / 2, reachEnd);
    edge([0, height + 6], [width, height + 6], -Math.PI / 2, reachEnd);
    edge([-6, 0], [-6, height], 0, reachSide);
    edge([width + 6, 0], [width + 6, height], Math.PI, reachSide);
    return sprigs;
  }

  const sprigs = $derived(w && h ? grow(w, h) : []);
  const back = $derived(sprigs.filter((s) => s.back));
  const front = $derived(sprigs.filter((s) => !s.back));
</script>

<div class="frame" bind:clientWidth={w} bind:clientHeight={h} aria-hidden="true">
  {#if sprigs.length}
    <svg width={w} height={h} viewBox="0 0 {w} {h}">
      {#each [back, front] as layer, n (n)}
        <g class={n === 0 ? 'back' : 'front'}>
          {#each layer as s, i (i)}
            <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} />
            {#each s.leaves as l, j (j)}
              <path transform="translate({l.x} {l.y}) rotate({l.angle})" d="M0 0Q{l.length / 2} {-l.width} {l.length} 0Q{l.length / 2} {l.width} 0 0Z" />
            {/each}
          {/each}
        </g>
      {/each}
    </svg>
  {/if}
</div>

<style>
  .frame { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
  svg { display: block; }
  g { --sage: #7fb08a; }
  line { stroke: var(--sage); stroke-width: 1.4; stroke-linecap: round; }
  path { fill: var(--sage); }
  .back { opacity: 0.22; }
  .front { opacity: 0.55; }
</style>
