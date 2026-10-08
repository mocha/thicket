import { getContext, setContext, type Snippet } from 'svelte';
import { profileHref, type Profile } from './api';

/**
 * A person's profile, split into tabs that share one header (issue #232):
 * Overview at /@handle, then a page each for Collections, Bookmarks, and
 * Activity. The header loads the profile once and hands it to whichever tab
 * is open, so switching tabs doesn't fetch it again.
 */
export type LoadedProfile = Extract<Profile, { private: false }>;
export type ProfileTab = 'overview' | 'collections' | 'bookmarks' | 'activity';
export const PROFILE_TABS: { value: ProfileTab; label: string }[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'collections', label: 'Collections' },
  { value: 'bookmarks', label: 'Bookmarks' },
  { value: 'activity', label: 'Activity' }
];

export const tabHref = (handle: string, tab: ProfileTab) => (tab === 'overview' ? profileHref(handle) : `${profileHref(handle)}/${tab}`);

/** Which tab an address opens; anything else under the profile is Overview. */
export function tabOf(pathname: string, handle: string): ProfileTab {
  const rest = decodeURIComponent(pathname).slice(profileHref(handle).length).replace(/\/$/, '');
  return (PROFILE_TABS.find((t) => rest === `/${t.value}`)?.value) ?? 'overview';
}

/**
 * What a visitor may see of each section. A section that isn't shared, or is
 * shared but empty, leaves no tab and no trace. The owner always gets every
 * tab, empty or not, since that's where they add things.
 */
export function shownTabs(p: LoadedProfile): Set<ProfileTab> {
  const s = new Set<ProfileTab>(['overview']);
  if (p.collections && (p.isMe || p.collections.length > 0)) s.add('collections');
  if (p.bookmarks && (p.isMe || p.bookmarks.count > 0)) s.add('bookmarks');
  if (p.activity) s.add('activity');
  return s;
}

const KEY = Symbol('profile');
/** `tabLine`: for the owner, the card saying who can see the open tab. Nothing for a visitor. */
export type ProfileContext = { readonly profile: LoadedProfile; tabLine: Snippet };
export const setProfileContext = (c: ProfileContext) => setContext(KEY, c);
export const getProfileContext = () => getContext<ProfileContext>(KEY);
