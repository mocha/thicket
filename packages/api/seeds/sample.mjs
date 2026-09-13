/**
 * Turn the two upstream lists into candidate files for `pnpm ingest`.
 *
 *   node seeds/sample.mjs <smallweb.txt> <dir of *.opml> [outDir]
 *
 * The shuffle seed is fixed, so the same inputs always produce the same
 * sample — a seeded index is reproducible rather than a one-off.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const [smallwebFile, opmlDir, outDir = '.'] = process.argv.slice(2);
if (!smallwebFile || !opmlDir) {
  console.error('usage: node seeds/sample.mjs <smallweb.txt> <dir of *.opml> [outDir]');
  process.exit(1);
}

/** Feeds taken per topic, and the most any one publisher may contribute. */
const PER_CATEGORY = 20;
const PER_PUBLISHER = 2;
const SMALL_WEB = 1300;

let seed = 20260913;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const shuffle = (a) => { const x = [...a]; for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; } return x; };
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return null; } };

// Big web: an even slice per topic, so browsing has range rather than 41 tech feeds.
const big = [];
const perPublisher = new Map();
for (const f of readdirSync(opmlDir).filter((f) => f.endsWith('.opml'))) {
  const urls = [...readFileSync(join(opmlDir, f), 'utf8').matchAll(/xmlUrl="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
  let taken = 0;
  for (const u of shuffle(urls)) {
    if (taken >= PER_CATEGORY) break;
    const h = host(u);
    if (!h || (perPublisher.get(h) ?? 0) >= PER_PUBLISHER) continue;
    perPublisher.set(h, (perPublisher.get(h) ?? 0) + 1);
    big.push(u);
    taken++;
  }
}

// Small web: a random slice of the long tail, one feed per site.
const all = readFileSync(smallwebFile, 'utf8').split('\n').map((s) => s.trim()).filter((s) => /^https?:\/\//.test(s));
const small = [];
const sites = new Set();
for (const u of shuffle(all)) {
  if (small.length >= SMALL_WEB) break;
  const h = host(u);
  if (!h || sites.has(h)) continue;
  sites.add(h);
  small.push(u);
}

writeFileSync(join(outDir, 'cand-bigweb.txt'), big.join('\n') + '\n');
writeFileSync(join(outDir, 'cand-smallweb.txt'), small.join('\n') + '\n');
console.log(`big web: ${big.length} from ${perPublisher.size} publishers`);
console.log(`small web: ${small.length} of ${all.length} in the list`);
