/**
 * What a reader's settings on a feed take away from it, in words.
 *
 * Only settings that REMOVE content are listed. A renamed feed is visibly
 * renamed, but a hidden post leaves no trace, so the reader has to be told.
 * Every future setting that hides something (keyword filters, say) adds its
 * sentence here, and every place that summarizes settings picks it up.
 */
export type ViewSettings = {
  /** Whether Shorts are left out of this feed for me, all things considered. */
  hideShorts?: boolean;
  /** What I set on this feed itself; null means it follows my default. */
  hideShortsSetting?: boolean | null;
};

export function hiddenContent(s: ViewSettings): string[] {
  const out: string[] = [];
  if (s.hideShorts) out.push(s.hideShortsSetting == null ? 'Shorts are hidden by your default for YouTube' : 'Shorts are disabled');
  return out;
}

/**
 * The "your settings are changing this feed" notice can be dismissed, and comes
 * back when the settings change. The dismissal remembers exactly which summary
 * was dismissed, so a different combination shows again; saving on the settings
 * page also clears it, so switching something off and on again brings it back.
 * Per browser: this is a convenience, not something worth an account setting.
 */
const key = (feedId: number) => `thicket:feed-notice-dismissed:${feedId}`;

export function noticeDismissed(feedId: number, summary: string[]): boolean {
  try { return localStorage.getItem(key(feedId)) === summary.join('|'); } catch { return false; }
}
export function dismissNotice(feedId: number, summary: string[]) {
  try { localStorage.setItem(key(feedId), summary.join('|')); } catch { /* storage unavailable: it just shows again next time */ }
}
export function resetNotice(feedId: number) {
  try { localStorage.removeItem(key(feedId)); } catch { /* nothing to clear */ }
}
