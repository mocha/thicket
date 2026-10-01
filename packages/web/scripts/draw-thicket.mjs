/**
 * Draws the thicket behind the landing page's green top section and saves it
 * as two pictures in static/: a wide one for laptops and a tall one for
 * phones. Run it by hand when the drawing should change:
 *
 *   node scripts/draw-thicket.mjs [seed]
 *
 * Branches grow in from all four edges and split into side branches, so every
 * stem traces back to an edge; leaves run in pairs the whole length of every
 * stem. Three layers give depth: very dark green branches furthest back, then
 * two layers of the secondary green. Each picture leaves a clearing where the
 * headline sits, with a slightly uneven edge, and leaves shrink a little as
 * they near it.
 *
 * Where the clearing goes was measured from the page: on a laptop the section
 * is 794px tall and the words sit 496px to 16px left of center, 273px to 520px
 * down (room for the longest headline). On a phone they sit across the top.
 * If the top section's layout changes, measure again and update PICTURES.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const seed = Number(process.argv[2] ?? 7);

const PICTURES = [
  /* Anchored at its center, so it lines up at every laptop width. 2000px wide: a wider
     screen shows plain green past its sides, but its side branches reach into view on a laptop. */
  { file: 'thicket-wide.svg', width: 2000, height: 794, clear: { x: 1000 - 496, y: 273, w: 480, h: 247 } },
  /* Anchored at its top center; the words run across the top on a phone. */
  { file: 'thicket-tall.svg', width: 820, height: 1000, clear: { x: 410 - 305, y: 40, w: 610, h: 200 } }
];

const COLORS = { deep: ['#0c1b11', 1], back: ['#7fb08a', 0.22], front: ['#7fb08a', 0.55] };

/** The same sequence of "random" numbers for a given seed. */
function seeded(n) {
  return () => {
    n = (n * 1664525 + 1013904223) % 4294967296;
    return n / 4294967296;
  };
}

function draw({ width, height, clear: bare }) {
  const rand = seeded(seed);
  const r = (n) => Math.round(n);

  const wobble = [0, 1, 2, 3, 4, 5].map(() => (rand() - 0.5) * 0.5);
  /** 1 on the clearing's edge, growing moving away from it. */
  function openness(x, y) {
    const dx = x - (bare.x + bare.w / 2), dy = y - (bare.y + bare.h / 2);
    const t = Math.atan2(dy, dx);
    const edge = 1 + wobble.reduce((sum, a, i) => sum + (a * Math.sin((i + 2) * t + i)) / (i + 1), 0);
    return Math.pow(Math.abs(dx / (bare.w / 2 + 34)) ** 4 + Math.abs(dy / (bare.h / 2 + 34)) ** 4, 0.25) / edge;
  }
  const blocked = (x, y) => openness(x, y) < 1 || x < -30 || x > width + 30 || y < -30 || y > height + 30;

  const layers = { deep: { stems: [], leaves: [] }, back: { stems: [], leaves: [] }, front: { stems: [], leaves: [] } };

  /* Points are written as short hops from the one before, which keeps the file small. */
  const n = (v) => { const s = String(r(v)); return s.startsWith('-') ? s : ` ${s}`; };
  function leaf(out, x, y, angle, length) {
    const cx = Math.cos(angle), cy = Math.sin(angle), bulge = length * 0.38;
    const tx = cx * length, ty = cy * length;
    const ax = tx / 2 - cy * bulge, ay = ty / 2 + cx * bulge, bx = tx / 2 + cy * bulge - tx, by = ty / 2 - cx * bulge - ty;
    out.push(`M${r(x)}${n(y)}q${n(ax)}${n(ay)}${n(tx)}${n(ty)}q${n(bx)}${n(by)}${n(-tx)}${n(-ty)}z`);
  }

  function branch(x, y, angle, length, depth, layer) {
    const size = { deep: 20, back: 17, front: 13 }[layer];
    const leaves = [], points = [`M${r(x)}${n(y)}l`], kids = [];
    let px = r(x), py = r(y);
    let travelled = 0, nextLeaf = 7, nextKid = 36 + rand() * 30;
    while (travelled < length) {
      angle += (rand() - 0.5) * 0.14;
      const nx = x + Math.cos(angle) * 6, ny = y + Math.sin(angle) * 6;
      if (blocked(nx, ny)) break;
      x = nx; y = ny; travelled += 6;
      points.push(`${n(r(x) - px)}${n(r(y) - py)}`);
      px = r(x); py = r(y);
      if (travelled >= nextLeaf) {
        const near = Math.min(1, Math.max(0.65, (openness(x, y) - 1) / 0.45));
        const s = size * near * (1 - 0.4 * (travelled / length)) * (0.85 + rand() * 0.3);
        const spread = 0.7 + rand() * 0.35;
        leaf(leaves, x, y, angle - spread, s);
        leaf(leaves, x, y, angle + spread, s);
        nextLeaf += 11;
      }
      if (depth < 2 && travelled >= nextKid && travelled < length * 0.8) {
        const side = rand() < 0.5 ? -1 : 1, kx = x, ky = y, ka = angle + side * (0.55 + rand() * 0.45), kl = (length - travelled) * (0.45 + rand() * 0.25);
        kids.push(() => branch(kx, ky, ka, kl, depth + 1, layer));
        nextKid += 48 + rand() * 40;
      }
    }
    if (travelled < 20) return;
    leaf(leaves, x, y, angle, size * 0.75);
    layers[layer].stems.push(points.join(''));
    layers[layer].leaves.push(...leaves);
    kids.forEach((k) => k());
  }

  function edge(from, to, inward, reach, gap = 64) {
    const span = Math.hypot(to[0] - from[0], to[1] - from[1]);
    for (let d = 10 + rand() * 30; d < span; d += gap + rand() * gap * 0.6) {
      const t = d / span;
      const x = from[0] + (to[0] - from[0]) * t, y = from[1] + (to[1] - from[1]) * t;
      if (rand() < 0.45) branch(x, y, inward + (rand() - 0.5) * 1.0, reach * (0.45 + rand() * 0.55), 0, 'back');
      if (rand() < 0.6) branch(x + (rand() - 0.5) * 50, y + (rand() - 0.5) * 50, inward + (rand() - 0.5) * 1.3, reach * (0.5 + rand() * 0.5), 0, 'deep');
      if (rand() < 0.7) branch(x + (rand() - 0.5) * 30, y + (rand() - 0.5) * 30, inward + (rand() - 0.5) * 1.2, reach * (0.2 + rand() * 0.3), 0, 'front');
    }
  }

  /*
   * The wide picture's own side edges sit off-screen on most laptops, so its
   * side branches reach far in (to just short of the words' clearing) and grow
   * closer together, filling the left and right of what a laptop shows.
   */
  const across = width * 0.43, down = height * 0.55;
  edge([0, -4], [width, -4], Math.PI / 2, down);
  edge([0, height + 4], [width, height + 4], -Math.PI / 2, down);
  edge([-4, 0], [-4, height], 0, across, 36);
  edge([width + 4, 0], [width + 4, height], Math.PI, across, 36);

  const groups = Object.entries(layers).map(([name, l]) => {
    const [color, opacity] = COLORS[name];
    return `<g opacity="${opacity}"><path d="${l.stems.join('')}" fill="none" stroke="${color}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><path d="${l.leaves.join('')}" fill="${color}"/></g>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${groups.join('')}</svg>\n`;
}

const out = fileURLToPath(new URL('../static/', import.meta.url));
for (const p of PICTURES) {
  const svg = draw(p);
  writeFileSync(out + p.file, svg);
  console.log(`${p.file}: ${(svg.length / 1024).toFixed(0)} KB`);
}
