import { redirect } from '@sveltejs/kit';

/** The main list was called Everything until issue #173; old links and installed apps land on New posts. */
export function load({ url }) {
  redirect(308, '/new-posts' + url.search);
}
