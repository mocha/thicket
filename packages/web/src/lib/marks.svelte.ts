/**
 * "What's new", the device's half.
 *
 * For each collection this browser remembers one point: the newest post the
 * reader has actually scrolled or paged past there. Opening a collection does
 * not move it; reading does. A collection this browser has never counted
 * starts a day back (seedMissing), so every collection has a point from the
 * first load and none sits silent waiting to be visited. The point lives in
 * this browser's storage under the signed-in person's id and never goes to
 * the account. To get counts, the points are sent to the server, which answers
 * "how many posts are newer" and "how busy is this collection" and keeps
 * nothing (api/src/routes/marks.ts).
 *
 * A post read anywhere is read everywhere: the server counts each feed from
 * the latest point among the collections holding it, and sends those points
 * back as `seen`, so a list marks exactly the posts its count counts.
 *
 * The count is a glance, not a debt: exact up to 98, then "99+".
 * The list itself shows where the new part ends (River.svelte).
 */
import { api, type Mark } from './api';
import { loadCollections } from './collections.svelte';

export const marks = $state<{ byId: Record<number, Mark>; seen: Record<number, string>; loaded: boolean; at: number }>({ byId: {}, seen: {}, loaded: false, at: 0 });

let userId: number | null = null;
let anchors: Record<number, string> = {};
const key = () => `thicket:marks:${userId}`;

function loadAnchors() {
  anchors = {};
  if (userId === null) return;
  try {
    const raw = localStorage.getItem(key());
    const o = raw ? (JSON.parse(raw) as unknown) : null;
    if (o && typeof o === 'object') {
      for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
        if (typeof v === 'string' && !Number.isNaN(Date.parse(v))) anchors[Number(k)] = v;
      }
    }
  } catch { /* nothing remembered on this device */ }
}

function saveAnchors() {
  try { localStorage.setItem(key(), JSON.stringify(anchors)); } catch { /* the points still hold for this session */ }
}

/** The signed-in person changed (or was learned): forget counts, load this device's points for them. */
export function resetMarks(nextUser: number | null) {
  userId = nextUser;
  marks.byId = {};
  marks.seen = {};
  marks.loaded = false;
  marks.at = 0;
  loadAnchors();
}

/** Where "new" starts for this collection on this device, or null if it has never been read here. */
export function anchorFor(collectionId: number): string | null {
  return anchors[collectionId] ?? null;
}

/** The reader has scrolled or paged past a post from `at` in this collection. The point only moves forward. */
export function advance(collectionId: number, at: string) {
  const cur = anchors[collectionId];
  if (cur && new Date(at) <= new Date(cur)) return;
  anchors[collectionId] = at;
  saveAnchors();
}

/** First time this device shows a collection: start from the newest post on screen, so the next visit has a baseline. */
export function begin(collectionId: number, at: string) {
  if (!anchors[collectionId]) { anchors[collectionId] = at; saveAnchors(); }
}

/** How far back a collection this device has never counted starts: its first number is what arrived today. */
const SEED_BACK_MS = 24 * 60 * 60_000;

/**
 * Give every collection a point, before the first count rather than on the
 * visit that would have set one.
 *
 * Opening a collection is what used to start it counting, so a browser that
 * had never opened News was told News had nothing new — the same answer as
 * being caught up, and one that never resolved itself, because only a visit
 * could fix it. Every collection gets a point here instead, a day back rather
 * than at the newest post, so the first glance says what arrived today instead
 * of nothing. The point is written down like any other, so from here on the
 * collection counts from where the reader actually stopped.
 */
function seedMissing(ids: number[]) {
  const at = new Date(Date.now() - SEED_BACK_MS).toISOString();
  let added = false;
  for (const id of ids) if (!anchors[id]) { anchors[id] = at; added = true; }
  if (added) saveAnchors();
}

/** The list knows exactly how many new posts remain above the point; say so without waiting for the next fetch. */
export function recount(collectionId: number, remaining: number) {
  const m = marks.byId[collectionId];
  if (m) marks.byId[collectionId] = { ...m, count: Math.min(remaining, 100), more: remaining > 100 };
}

let inflight: Promise<void> | null = null;

export function loadMarks(force = false): Promise<void> {
  if (marks.loaded && !force) return Promise.resolve();
  if (inflight) return inflight;
  inflight = loadCollections()
    .then((cs) => seedMissing(cs.list.map((c) => c.id)))
    .catch(() => { /* no list this time; the points already here still count */ })
    .then(() => {
      const sent: Record<string, string> = {};
      for (const [k, v] of Object.entries(anchors)) sent[k] = v;
      return api.marksCounts(sent);
    })
    .then((r) => {
      const byId: Record<number, Mark> = {};
      for (const m of r.marks) byId[m.collectionId] = m;
      marks.byId = byId;
      marks.seen = r.seen;
      marks.loaded = true;
      marks.at = Date.now();
    })
    .catch(() => { /* the sidebar just shows no counts until the next try */ })
    .finally(() => { inflight = null; });
  return inflight;
}

export type Badge = { kind: 'none' } | { kind: 'count'; text: string };

/** What the sidebar shows for a collection: nothing, or how many are new. */
export function badge(m: Mark | undefined): Badge {
  const text = countText(m);
  return text ? { kind: 'count', text } : { kind: 'none' };
}

/** How many are new: the number, or "99+" past 98. */
export function countText(m: Mark | undefined): string {
  if (!m || !m.count) return '';
  return m.more || m.count >= 99 ? '99+' : String(m.count);
}

/** Anything new in any of these? For a parent's row and for a tab with no room for numbers. */
export function anyNew(ids: number[]): boolean {
  return ids.some((id) => (marks.byId[id]?.count ?? 0) > 0);
}

const EVERY_MS = 5 * 60_000;
const STALE_MS = 60_000;

/**
 * Keep the counts current while the option is on: now, every five minutes
 * while the tab is visible, and on coming back to a tab that has been away
 * for a minute. An active feed is fetched every half hour, so anything
 * faster would only ask the same question again.
 */
export function watchMarks(): () => void {
  void loadMarks(true);
  const tick = () => { if (document.visibilityState === 'visible') void loadMarks(true); };
  const iv = setInterval(tick, EVERY_MS);
  const onVisible = () => { if (document.visibilityState === 'visible' && Date.now() - marks.at > STALE_MS) void loadMarks(true); };
  document.addEventListener('visibilitychange', onVisible);
  return () => { clearInterval(iv); document.removeEventListener('visibilitychange', onVisible); };
}
