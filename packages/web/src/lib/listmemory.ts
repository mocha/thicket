/**
 * Lists remember themselves for the back button.
 *
 * Every list here loads after its page appears. On Back, the router puts the
 * scroll position back straight away, while the list is still empty, so there
 * is nothing to scroll and you land at the top. So a list keeps what it had
 * when its page is left, and on Back or Forward to that same spot in history it
 * starts from that instead of loading afresh: the rows are there in the first
 * frame and the scroll lands where you were. Any other way of arriving (a link,
 * the nav, a reload) loads fresh, as before.
 *
 * Kept in memory only, so a reload forgets it, and only the last few pages.
 */
import { beforeNavigate, onNavigate } from '$app/navigation';
import { onMount } from 'svelte';

/** The router's number for each history entry. Two visits to the same address are different entries. */
const HISTORY_INDEX = 'sveltekit:history';
const LIMIT = 30;

const kept = new Map<string, { value: unknown; scrollY: number }>();
let popped = false;

const here = (name: string) => `${name}|${history.state?.[HISTORY_INDEX] ?? ''}|${location.href}`;

/** Once, in the root layout: note whether each navigation is Back/Forward. */
export function watchBackForward() {
  onNavigate((nav) => { popped = nav.type === 'popstate'; });
}

/**
 * During a list's setup: what it kept when this page was last left, if we have
 * just come back to it with Back or Forward; otherwise nothing. When there is
 * something, the page is also scrolled back once it has drawn, for lists that
 * appear after the router has already restored the scroll.
 */
export function recall<T>(name: string): T | undefined {
  if (!popped) return undefined;
  const k = kept.get(here(name));
  if (!k) return undefined;
  onMount(() => { if (Math.abs(window.scrollY - k.scrollY) > 1) window.scrollTo(0, k.scrollY); });
  return k.value as T;
}

/** During a list's setup: keep `save()` under `name()` whenever this page is left. */
export function keepOnLeave<T>(name: () => string, save: () => T) {
  beforeNavigate(() => {
    const key = here(name());
    kept.delete(key);
    kept.set(key, { value: save(), scrollY: window.scrollY });
    if (kept.size > LIMIT) kept.delete(kept.keys().next().value!);
  });
}
