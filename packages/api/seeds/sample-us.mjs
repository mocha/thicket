/**
 * A second big-web slice, for range beyond the first seed's list (see README:
 * "The 2026-09-30 addition"). Writes a candidate file for `pnpm ingest`.
 *
 *   node seeds/sample-us.mjs <core_feeds.py> <hn-popular-blogs.opml> [outDir]
 *
 * Same rules as sample.mjs: an even slice per topic, at most two feeds per
 * publisher, and a fixed shuffle seed so the same inputs give the same sample.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [coreFile, blogsFile, outDir = '.'] = process.argv.slice(2);
if (!coreFile || !blogsFile) {
  console.error('usage: node seeds/sample-us.mjs <core_feeds.py> <hn-popular-blogs.opml> [outDir]');
  process.exit(1);
}

const PER_CATEGORY = 20;
const PER_PUBLISHER = 2;
/** Topics that aren't reading material: a note about sign-ins, and a single-issue politics feed set. */
const SKIP_TOPICS = new Set(['Freedom From Accounts', 'Guns']);
/**
 * Not feeds a person would follow: Google News search results, Reddit (rate
 * limited, and a subreddit is a different thing), YouTube (followed by channel,
 * not by topic).
 */
const SKIP_FEEDS = [/news\.google\.com/, /reddit\.com/, /youtube\.com/];

let seed = 20260930;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const shuffle = (a) => { const x = [...a]; for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; } return x; };
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return null; } };

// core_feeds.py is one Python dict, `feeds = { "Topic": [ "url", ... ], ... }`.
// Read it as text rather than running it: topic names and quoted URLs are all we need.
const topics = new Map();
let topic = null;
for (const line of readFileSync(coreFile, 'utf8').split('\n')) {
  const t = /^\s{4}"([^"]+)":\s*\[/.exec(line);
  if (t) { topic = t[1]; topics.set(topic, []); continue; }
  const u = /^\s+"(https?:\/\/[^"]+)",?\s*$/.exec(line);
  if (u && topic) topics.get(topic).push(u[1]);
}

const out = [];
const perPublisher = new Map();
for (const [name, urls] of topics) {
  if (SKIP_TOPICS.has(name)) continue;
  let taken = 0;
  for (const u of shuffle(urls.filter((u) => !SKIP_FEEDS.some((re) => re.test(u))))) {
    if (taken >= PER_CATEGORY) break;
    const h = host(u);
    if (!h || (perPublisher.get(h) ?? 0) >= PER_PUBLISHER) continue;
    perPublisher.set(h, (perPublisher.get(h) ?? 0) + 1);
    out.push(u);
    taken++;
  }
}

// Well-known blogs: all of them, one per site.
const blogs = [...readFileSync(blogsFile, 'utf8').matchAll(/xmlUrl="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
let blogCount = 0;
for (const u of blogs) {
  const h = host(u);
  if (!h || perPublisher.has(h)) continue;
  perPublisher.set(h, 1);
  out.push(u);
  blogCount++;
}

writeFileSync(join(outDir, 'cand-us.txt'), out.join('\n') + '\n');
console.log(`${out.length - blogCount} from ${topics.size - SKIP_TOPICS.size} topics, ${blogCount} well-known blogs`);
