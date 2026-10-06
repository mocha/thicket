/**
 * Saving this device's display settings to the account, to offer new devices
 * (issue #186). Three deliberate actions save, and all come through here: a
 * new account's first setup, "Use these on new devices" in Settings, and yes
 * to the one-time offer older accounts see. Changing a setting never does.
 *
 * Saving can fail without anything on this device changing, so a failure
 * says why in a message, is written to the browser console for support, and
 * the server logs any refusal with its reason.
 */
import { ApiError, api, authApi } from './api';
import { currentDisplay } from './display.svelte';
import { session } from './session.svelte';
import { showToast } from './toast.svelte';

/** Setup opened during this visit, so the one-time offer waits for another (it never shows on top of setup or right after it). */
export const setupVisit = $state({ opened: false });

export type SaveVia = 'setup' | 'settings' | 'offer';

/** True if it saved. `quiet` leaves out the success message, for setup, which is already moving on. */
export async function saveForNewDevices(via: SaveVia, { quiet = false } = {}): Promise<boolean> {
  try {
    const me = await authApi.saveDisplay(currentDisplay());
    // Only what saving changed: the reply may predate something else this visit
    // just recorded (the tour, sent at the same moment), and must not undo it.
    if (session.user?.id === me.id) Object.assign(session.user, { savedDisplay: me.savedDisplay, saveFirstDisplay: me.saveFirstDisplay, displayOfferAnsweredAt: me.displayOfferAnsweredAt });
    api.event('display_saved', { via });
    if (!quiet) showToast('Saved. New devices will offer these settings');
    return true;
  } catch (e) {
    const reason = e instanceof ApiError ? e.message : 'thicket couldn’t be reached';
    console.error(`Couldn't save display settings for new devices (${via}):`, e);
    api.event('display_save_failed', { via, reason });
    showToast(`Couldn’t save your settings: ${reason}. They still apply on this device`);
    return false;
  }
}
