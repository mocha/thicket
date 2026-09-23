import { redirect } from '@sveltejs/kit';

/** Notes live on the Bookmarks page now (issue #84); old links land on its "With notes" tab. */
export function load() {
  redirect(308, '/bookmarks?notes=1');
}
