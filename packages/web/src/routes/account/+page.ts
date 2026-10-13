import { redirect } from '@sveltejs/kit';

/** Account and data is a tab of Settings now; old links land on it. */
export function load() {
  redirect(308, '/settings?tab=account');
}
