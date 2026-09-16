/**
 * "What's new", the device's half.
 *
 * For each collection this browser remembers one point: the newest post the
 * reader has actually scrolled or paged past there. Opening a collection does
 * not move it; reading does. The point lives in this browser's storage under
 * the signed-in person's id and never goes to the account. To get counts, the
 * points are sent to the server, which answers "how many posts are newer" and
 * "how busy is this collection" and keeps nothing (api/src/routes/marks.ts).
 *
 * The count is a glance, not a debt: exact for a quiet collection, capped for
 * a medium one, a mere dot for a firehose, where no number would mean anything.
 * The list itself shows where the new part ends (River.svelte).
 */
import { api, type Mark } from './api';

export const marks = $state<{ byId: Record<number, Mark>; loaded: boolean; at: number }>({ byId: {}, loaded: false, at: 0 });

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

/** The list knows exactly how many new posts remain above the point; say so without waiting for the next fetch. */
export function recount(collectionId: number, remaining: number) {
  const m = marks.byId[collectionId];
  if (m) marks.byId[collectionId] = { ...m, count: Math.min(remaining, 100), more: remaining > 100 };
}

let inflight: Promise<void> | null = null;

export function loadMarks(force = false): Promise<void> {
  if (marks.loaded && !force) return Promise.resolve();
  if (inflight) return inflight;
  const sent: Record<string, string> = {};
  for (const [k, v] of Object.entries(anchors)) sent[k] = v;
  inflight = api.marksCounts(sent)
    .then((r) => {
      const byId: Record<number, Mark> = {};
      for (const m of r.marks) byId[m.collectionId] = m;
      marks.byId = byId;
      marks.loaded = true;
      marks.at = Date.now();
    })
    .catch(() => { /* the sidebar just shows no counts until the next try */ })
    .finally(() => { inflight = null; });
  return inflight;
}

/** Posts a week past which a collection is a firehose: a number would always be saturated, so it gets a dot. */
const FIREHOSE_WEEKLY = 200;
/** Under this many a week the collection is quiet, and the exact number is the useful answer. */
const QUIET_WEEKLY = 20;

export type Badge = { kind: 'none' } | { kind: 'dot'; title: string } | { kind: 'count'; text: string };

/** What the sidebar shows for a collection: nothing, a dot, or a number sized to how busy it is. */
export function badge(m: Mark | undefined): Badge {
  if (!m || !m.count) return { kind: 'none' };
  const exact = m.more ? '100+' : String(m.count);
  if (m.weekly >= FIREHOSE_WEEKLY) return { kind: 'dot', title: `${exact} new` };
  if (m.weekly < QUIET_WEEKLY) return { kind: 'count', text: exact };
  return { kind: 'count', text: m.count > 50 ? '50+' : String(m.count) };
}

/** The plain number, for a list with room for it. */
export function countText(m: Mark | undefined): string {
  if (!m || !m.count) return '';
  return m.more ? '100+' : String(m.count);
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
