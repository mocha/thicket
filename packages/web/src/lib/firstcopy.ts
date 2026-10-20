/**
 * Closing the loop on a first copy (issue #308). Someone who follows nothing
 * and copies a collection has just filled New posts, the screen the tour
 * called home, but the note after a copy offered only the collection's own
 * page. For that first copy it says where the posts went, and its button
 * goes there.
 */
import { goto } from '$app/navigation';
import { api } from '$lib/api';
import { showToast } from '$lib/toast.svelte';

/** Whether this account follows nothing yet. When that can't be found out it's taken as no, so a copy says what it always said. */
export async function followsNothing(): Promise<boolean> {
  try {
    return (await api.riverStats()).feeds === 0;
  } catch {
    return false;
  }
}

/** The note after a first copy (one name, or several copied at once): where the posts went, and the way there. */
export function firstCopyToast(names: string[]) {
  const what = names.length === 1 ? `Copied “${names[0]}”. Its posts are` : `Copied ${names.length} collections. Their posts are`;
  showToast(`${what} waiting in New posts.`, { label: 'Start reading', run: () => goto('/new-posts') });
}
