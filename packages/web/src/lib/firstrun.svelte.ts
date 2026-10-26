/**
 * First run (THICKET-34): what a brand-new account sees, in order.
 *
 * 1. New posts is the picker. Following nothing, it's a welcome with the
 *    starter collections to tick and one button to copy them; posts fill in
 *    on the same page. No dialog comes first.
 * 2. Once there are posts, the tour: one card per menu item, each sitting by
 *    the real item with the rest of the screen dimmed (Tour.svelte). Once per
 *    account, as before.
 * 3. After the tour, a note on New posts offers the appearance choices, until
 *    it's used or closed. That's kept on the device, like the choices are.
 *
 * Accounts that existed before this, and second devices, keep the setup
 * dialog they had (Configurator.svelte); only its tour moved here.
 */
import { api, profilesApi, type ExploreCollection } from './api';
import { session } from './session.svelte';
import { welcome } from './copyintent.svelte';

export const tour = $state({ open: false });

/** A new account: made in the last day and hasn't seen the tour. It skips the setup dialog; New posts and the tour take its place. */
export function isNewcomer(): boolean {
  const u = session.user;
  if (!u || u.tourSeenAt) return false;
  return Date.now() - new Date(u.createdAt).getTime() < 24 * 60 * 60 * 1000;
}

/** The account still owes the tour. */
export const tourOwed = () => !!session.user && !session.user.tourSeenAt;

/**
 * Start the tour if it's owed, not already showing, and the setup dialog
 * isn't open (that starts it itself when it closes). True if it started.
 * `again`: the dev reopening it with ?tour or ?setup.
 */
export function startTour(again = false): boolean {
  if (tour.open || welcome.open || (!again && !tourOwed())) return false;
  tour.open = true;
  return true;
}

const NOTE_KEY = 'thicket:appearance-note';
/** The appearance note on New posts: 'show' after the tour, 'done' once it's used or closed. */
export const appearanceNote = $state<{ state: 'show' | 'done' | null }>({ state: read() });
function read(): 'show' | 'done' | null {
  try { const v = localStorage.getItem(NOTE_KEY); return v === 'show' || v === 'done' ? v : null; } catch { return null; }
}
export function setAppearanceNote(state: 'show' | 'done') {
  appearanceNote.state = state;
  try { localStorage.setItem(NOTE_KEY, state); } catch { /* Blocked storage: it lasts this visit. */ }
}

/** Asks the setup dialog to open on its list of appearance choices alone (the note's Choose). */
export const choices = $state({ requested: false });

/**
 * Copy the starter packs someone ticked, one at a time, so each copy's name is
 * checked against the ones before it. A failure doesn't stop the rest: it
 * comes back with its reason, and is logged for support.
 */
export async function copyPacks(picked: ExploreCollection[], via: string): Promise<{ name: string; why: string }[]> {
  const failed: { name: string; why: string }[] = [];
  for (const c of picked) {
    try {
      await profilesApi.copyCollection(c.handle, c.slug);
      api.event('starter_pack_copied', { collectionId: c.id, via });
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      console.error(`[starter packs] copying @${c.handle}/${c.slug} failed:`, e);
      api.event('starter_pack_copy_failed', { collectionId: c.id, reason: why });
      failed.push({ name: c.name, why });
    }
  }
  return failed;
}
