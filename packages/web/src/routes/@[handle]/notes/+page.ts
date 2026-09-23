import { redirect } from '@sveltejs/kit';

/** Someone's notes live on their Bookmarks page now (issue #84); old links land on it, narrowed to the noted posts. */
export function load({ params }) {
  redirect(308, `/@${params.handle}/bookmarks?notes=1`);
}
