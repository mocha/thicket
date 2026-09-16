/**
 * Who is signed in. Loaded once by the root layout before any page renders;
 * every page can read session.user synchronously after that. The API holds the
 * truth in an HttpOnly cookie; this is just the client's mirror of it.
 */
import { ApiError, authApi, setUnauthorizedHandler, type Me } from './api';
import { resetCollections } from './collections.svelte';
import { closeAddFeed } from './addfeed.svelte';

export const session = $state<{ user: Me | null; loaded: boolean; unreachable: string | null }>({ user: null, loaded: false, unreachable: null });

/**
 * The one place the user changes. Every per-user cache in the app (the
 * collections list, an open add-feed sheet) is module state that outlives a
 * log-out inside the single-page app, so a different user is the signal to
 * drop it all. Same user (a profile edit) keeps the caches.
 */
function applyUser(me: Me | null) {
  if (me?.id !== session.user?.id) {
    resetCollections();
    closeAddFeed();
  }
  session.user = me;
}

/**
 * Only a 401 means "signed out". A 429 from a proxy, a network error, or a
 * 5xx means "can't reach the server right now": keep retrying with backoff
 * and tell the user, rather than treating them as logged out.
 */
export async function loadMe(): Promise<Me | null> {
  for (let attempt = 0; ; attempt++) {
    try {
      applyUser(await authApi.me());
      session.unreachable = null;
      break;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) { applyUser(null); session.unreachable = null; break; }
      session.unreachable = e instanceof ApiError ? `HTTP ${e.status}` : 'no response';
      if (attempt >= 6) { applyUser(null); break; }
      await new Promise((r) => setTimeout(r, Math.min(8000, 1000 * 2 ** attempt)));
    }
  }
  session.loaded = true;
  return session.user;
}

export function setMe(me: Me | null) {
  applyUser(me);
  session.loaded = true;
}

/** Any 401 from the API means the session is gone; forget the user and let the layout redirect. */
setUnauthorizedHandler(() => {
  if (session.user) applyUser(null);
});

/**
 * Public routes render signed out; everything else needs a user. A feed's page
 * is public, and so is a post on it — a link someone shares has to open for
 * whoever they sent it to, saying what the post is and where the original
 * lives. The post's text is a separate, members-only fetch. A feed's settings
 * page is not public.
 */
export function isPublicPath(pathname: string): boolean {
  if (pathname === '/' || pathname === '/login' || pathname === '/signup' || pathname.startsWith('/@')) return true;
  // /feeds/:id, /feeds/:id/:slug, and a post under it: /feeds/:id/:slug/:item/:itemslug.
  return /^\/feeds\/\d+(\/(?!settings\/?$)[^/]+(\/\d+(\/[^/]*)?)?)?\/?$/.test(pathname);
}
