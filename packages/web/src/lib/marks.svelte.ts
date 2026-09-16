/**
 * "What's new": for each of my collections, how many posts have arrived since I
 * last opened it, and the moment that count starts from. Loaded only when this
 * device has the option on (display.fresh), refreshed every five minutes while
 * the tab is visible, and moved forward when a collection's river renders.
 *
 * What the server keeps is one timestamp per collection, and only devices with
 * the option on ever write it. Nothing here knows which posts anyone read.
 */
import { api, type Mark } from './api';

export const marks = $state<{ byId: Record<number, Mark>; loaded: boolean; at: number }>({ byId: {}, loaded: false, at: 0 });

let inflight: Promise<void> | null = null;

export function loadMarks(force = false): Promise<void> {
  if (marks.loaded && !force) return Promise.resolve();
  if (inflight) return inflight;
  inflight = api.marks()
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

/** Forget everything; the signed-in person changed. */
export function resetMarks() {
  marks.byId = {};
  marks.loaded = false;
  marks.at = 0;
}

/**
 * I have just looked at this collection; the newest post on screen was from
 * `seenAt`. The count drops to zero here at once and the server keeps the later
 * of what it had and this. Only my own collections have marks, so an id that
 * is not in the list (someone else's collection) is left alone.
 */
export async function markSeen(collectionId: number, seenAt: string) {
  const m = marks.byId[collectionId];
  if (!m) return;
  const since = new Date(seenAt) > new Date(m.since) ? seenAt : m.since;
  marks.byId[collectionId] = { ...m, since, count: 0, more: false };
  if (since === m.since && m.count === 0) return;
  try { await api.markSeen(collectionId, since); } catch { /* next load says what the server thinks */ }
}

/** The number on a badge: nothing, a count, or "100+". */
export function badge(m: Mark | undefined): string {
  if (!m || !m.count) return '';
  return m.more ? '100+' : String(m.count);
}

/** Is there anything new in any of these collections? For a dot on a tab that has no room for numbers. */
export function anyNew(ids: number[]): boolean {
  return ids.some((id) => (marks.byId[id]?.count ?? 0) > 0);
}

const EVERY_MS = 5 * 60_000;
const STALE_MS = 60_000;

/**
 * Keep the counts current while the option is on: load now, again every five
 * minutes while the tab is visible, and on coming back to a tab that has been
 * away for a minute or more. An active feed is fetched every half hour, so
 * anything faster than this would only ask the same question again.
 */
export function watchMarks(): () => void {
  void loadMarks(true);
  const tick = () => { if (document.visibilityState === 'visible') void loadMarks(true); };
  const iv = setInterval(tick, EVERY_MS);
  const onVisible = () => { if (document.visibilityState === 'visible' && Date.now() - marks.at > STALE_MS) void loadMarks(true); };
  document.addEventListener('visibilitychange', onVisible);
  return () => { clearInterval(iv); document.removeEventListener('visibilitychange', onVisible); };
}
