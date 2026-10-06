import type { ShareLevel } from '$lib/api';

/**
 * The badge a collection wears on its owner's own pages when its audience is
 * narrower than the web. Public collections wear nothing: that is the common
 * case, and a tag on every row would say nothing. Only the owner ever sees
 * these, so they are written from their side — "People I follow", the same
 * words as the setting itself.
 */
export function audienceTag(v: ShareLevel): string | null {
  return v === 'private' ? 'Private' : v === 'friends' ? 'People I follow' : null;
}

/** The start of "… can see your notes" for each audience: the profile's sharing summary and the line under the note box. */
export const SEES: Record<ShareLevel, string> = { private: 'Only you can see', friends: 'Only people you follow can see', public: 'Anyone can see' };
