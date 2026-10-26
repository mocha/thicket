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
 *    it's used or closed. That's kept on the device, like the choices are,
 *    and for that account only, so someone else signing in here never sees it.
 *
 * Accounts that existed before this, and second devices, keep the setup
 * dialog they had (Configurator.svelte); only its tour moved here.
 */
import { api, profilesApi, type ExploreCollection } from './api';
import { session } from './session.svelte';

/** Open while it shows. The tour starts itself (Tour.svelte); setting this is only for the dev's ?tour and ?setup. */
export const tour = $state({ open: false });

/** Made in the last day. */
export function accountIsNew(): boolean {
  const u = session.user;
  return !!u && Date.now() - new Date(u.createdAt).getTime() < 24 * 60 * 60 * 1000;
}

/** A new account that hasn't seen the tour. It skips the setup dialog; New posts and the tour take its place. */
export const isNewcomer = () => accountIsNew() && !session.user?.tourSeenAt;

/** The account still owes the tour. */
export const tourOwed = () => !!session.user && !session.user.tourSeenAt;

type Note = 'show' | 'done';
const noteKey = (id: number) => `thicket:appearance-note:${id}`;
/** This visit's answers, for when storage is blocked; `changed` makes readers look again after a write. */
const visit = new Map<number, Note>();
let changed = $state(0);
/** The appearance note on New posts, for whoever is signed in: 'show' after their tour, 'done' once it's used or closed. */
export function appearanceNote(): Note | null {
  void changed;
  const id = session.user?.id;
  if (id == null) return null;
  if (visit.has(id)) return visit.get(id)!;
  try { const v = localStorage.getItem(noteKey(id)); return v === 'show' || v === 'done' ? v : null; } catch { return null; }
}
export function setAppearanceNote(state: Note) {
  const id = session.user?.id;
  if (id == null) return;
  visit.set(id, state);
  changed++;
  try { localStorage.setItem(noteKey(id), state); } catch { /* Blocked storage: it lasts this visit. */ }
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
