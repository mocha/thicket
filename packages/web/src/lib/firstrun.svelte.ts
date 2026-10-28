/**
 * First run: the tour (Tour.svelte), which the setup dialog opens as its last
 * step, and copying the starter packs someone ticked.
 */
import { api, profilesApi, type ExploreCollection } from './api';

/**
 * The tour. The setup dialog opens it with the word for its last button, and
 * `after` runs once it closes (where setup ends: Explore, Collections, or
 * Import). Development's ?tour opens it too.
 */
export const tour = $state<{ open: boolean; done: string; after: (() => void) | null }>({ open: false, done: 'Start reading', after: null });

/**
 * Copy the starter packs someone ticked, one at a time, so each copy's name is
 * checked against the ones before it. A failure doesn't stop the rest: it
 * comes back with its reason, and is logged for support.
 */
export async function copyPacks(picked: ExploreCollection[], via: string): Promise<{ id: number; name: string; why: string }[]> {
  const failed: { id: number; name: string; why: string }[] = [];
  for (const c of picked) {
    try {
      await profilesApi.copyCollection(c.handle, c.slug);
      api.event('starter_pack_copied', { collectionId: c.id, via });
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      console.error(`[starter packs] copying @${c.handle}/${c.slug} failed:`, e);
      api.event('starter_pack_copy_failed', { collectionId: c.id, reason: why });
      failed.push({ id: c.id, name: c.name, why });
    }
  }
  return failed;
}
