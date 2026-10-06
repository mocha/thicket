/**
 * The Notifications bubble (issue #184): how many things happened since I
 * last opened Notifications. The server works it out and keeps the one time
 * it is counted from on my account (api/src/routes/notifications.ts), so it is
 * the same on every device, unlike "what's new", which is per device.
 *
 * Asked again when I move between pages and when I come back to the tab, at
 * most once a minute either way. No timer: someone sitting on one page finds
 * out on their next move, which is soon enough for a follow or a note.
 */
import { notificationsApi } from './api';

export const notifs = $state<{ count: number; more: boolean; at: number }>({ count: 0, more: false, at: 0 });

/** What the bubble says: nothing, the number, or "99+". */
export function notifText(): string {
  if (!notifs.count) return '';
  return notifs.more || notifs.count >= 99 ? '99+' : String(notifs.count);
}

/** The signed-in person changed: forget their count. */
export function resetNotifs() {
  notifs.count = 0;
  notifs.more = false;
  notifs.at = 0;
}

/** Notifications was just opened and marked seen: nothing is new any more. */
export function clearNotifs() {
  notifs.count = 0;
  notifs.more = false;
  notifs.at = Date.now();
}

const STALE_MS = 60_000;
let inflight: Promise<void> | null = null;

export function loadNotifs(force = false): Promise<void> {
  if (!force && Date.now() - notifs.at < STALE_MS) return Promise.resolve();
  if (inflight) return inflight;
  inflight = notificationsApi.count()
    .then((r) => { notifs.count = r.count; notifs.more = r.more; notifs.at = Date.now(); })
    .catch(() => { /* no bubble this time; the next move asks again */ })
    .finally(() => { inflight = null; });
  return inflight;
}

/** Recount on coming back to the tab. Navigation is the caller's: it knows when the page changed. */
export function watchNotifs(): () => void {
  void loadNotifs(true);
  const onVisible = () => { if (document.visibilityState === 'visible') void loadNotifs(); };
  document.addEventListener('visibilitychange', onVisible);
  return () => document.removeEventListener('visibilitychange', onVisible);
}
