/**
 * Saving this device's display settings to the account, to offer new devices
 * (issue #186). Saving makes this device the source: while it stays one
 * ("Use these settings on new devices", checked in Settings), its changes
 * keep the saved copy up to date. The box starts checked on an account's
 * first device: a new account's first setup, or the first device an account
 * from before this change opens. After that only checking the box moves it.
 * Other devices never change on their own: a device only takes the saved
 * copy when it's first set up, and only if asked.
 *
 * Saving can fail without anything on this device changing, so a failure
 * says why in a message, is written to the browser console for support, and
 * the server logs any refusal with its reason.
 */
import { ApiError, api, authApi } from './api';
import { currentDisplay, display, displayRecord, type Display } from './display.svelte';
import { session } from './session.svelte';
import { showToast } from './toast.svelte';

/** Setup opened during this visit. It saves the first device's settings itself when it closes, so the default here stays out of its way. */
export const setupVisit = $state({ opened: false });

export type SaveVia = 'setup' | 'settings' | 'first-device' | 'sync';

const DEVICE_KEY = 'thicket:device';
let device: string | null = null;
/**
 * This device's id: random, kept in its own storage, so the account can tell
 * which device is the source. Where storage is blocked it lasts as long as
 * the page, so the box can still be checked for this visit.
 */
export function deviceId(): string {
  if (device) return device;
  try {
    device = localStorage.getItem(DEVICE_KEY);
    if (!device) { device = newId(); localStorage.setItem(DEVICE_KEY, device); }
  } catch { device ??= newId(); }
  return device;
}

/** 32 random hex digits. Not crypto.randomUUID: browsers only offer that on https, and a self-hosted site on a home network is often plain http. */
function newId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Whether this device keeps the saved settings up to date. */
export const isSource = () => !!session.user?.displaySource && session.user.displaySource === deviceId();

/** Copy over only what saving changes: a reply can predate something else this visit just recorded (the tour, sent at the same moment), and must not undo it. */
function takeSaved(me: { id: number; savedDisplay: Display | null; displaySource: string | null; saveFirstDisplay: boolean; displayOfferAnsweredAt: string | null }) {
  if (session.user?.id === me.id) Object.assign(session.user, { savedDisplay: me.savedDisplay, displaySource: me.displaySource, saveFirstDisplay: me.saveFirstDisplay, displayOfferAnsweredAt: me.displayOfferAnsweredAt });
}

const failed = (via: SaveVia, e: unknown) => {
  const reason = e instanceof ApiError ? e.message : 'thicket couldn’t be reached';
  console.error(`Couldn't save display settings for new devices (${via}):`, e);
  api.event('display_save_failed', { via, reason });
  return reason;
};

/**
 * True if it saved. `quiet` leaves out the success message, for saving
 * nobody pressed a button for. A failure is still shown, except for the
 * older-account default, which nobody asked for: that is only logged, and
 * tried again next visit.
 */
export async function saveForNewDevices(via: SaveVia, { quiet = false } = {}): Promise<boolean> {
  try {
    takeSaved(await authApi.saveDisplay(currentDisplay(), deviceId(), via === 'sync' ? 'sync' : via === 'first-device' ? 'first' : undefined));
    if (via !== 'sync') api.event('display_saved', { via });
    if (!quiet) showToast('Saved. New devices will offer these settings');
    return true;
  } catch (e) {
    const reason = failed(via, e);
    if (via !== 'first-device') showToast(`Couldn’t save your settings: ${reason}. They still apply on this device`);
    return false;
  }
}

/** Stop this device keeping the saved settings up to date. True if it stopped. */
export async function stopBeingSource(): Promise<boolean> {
  try {
    takeSaved(await authApi.stopDisplaySource(deviceId()));
    api.event('display_source_stopped');
    return true;
  } catch (e) {
    showToast(`Couldn’t change that: ${failed('settings', e)}`);
    return false;
  }
}

/** Same settings, whatever order the fields came back in (the database doesn't keep it). */
const same = (a: Display, b: Display) => {
  const flat = (d: Display) => JSON.stringify([d.appearance, d.palette, d.accent, d.reading, d.layout, d.fresh, ...(['headings', 'reading', 'app'] as const).map((r) => [d.fonts[r].family, d.fonts[r].size])]);
  return flat(a) === flat(b);
};

/**
 * While this device is the source, keep the saved copy in step with it: a
 * second after the last change, save again. Also makes an older account's
 * first device the source. Call once, from the root layout.
 */
export function keepSavedInStep() {
  // An account from before saved settings: the first device it opens, once set up, becomes the source.
  let firstTried = false;
  $effect(() => {
    const u = session.user;
    if (firstTried || !u || u.displayOfferAnsweredAt || u.savedDisplay || !display.configured || setupVisit.opened) return;
    firstTried = true;
    void saveForNewDevices('first-device', { quiet: true });
  });
  $effect(() => {
    if (!session.user || !display.configured || !isSource()) return;
    const now = displayRecord();
    if (session.user.savedDisplay && same(now, session.user.savedDisplay)) return;
    const t = setTimeout(() => void saveForNewDevices('sync', { quiet: true }), 1000);
    return () => clearTimeout(t);
  });
}
