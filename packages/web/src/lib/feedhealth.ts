/**
 * A feed's health, in words, for its admins (issue #103). The Admin feed list
 * shows one word (`healthWord`); the feed's Manage page leads with what went
 * wrong and the one thing to do about it (`diagnose`).
 *
 * Read off the feed's last status and error, the way the Add a feed sheet
 * words a failed add (api feeds/explain.ts), so the two say the same thing
 * about the same failure. The fetcher keeps the reason behind a bare "fetch
 * failed" in brackets after it (feeds/refresh.ts), which is how a site that's
 * gone is told apart from one that's merely down.
 */

/** Failed checks in a row before a feed is broken rather than having a bad day; the server's BROKEN_AFTER. */
export const BROKEN_AFTER = 5;

type Health = { consecutiveFailures: number; lastFetchedAt: string | null };

export function healthWord(f: Health, brokenAfter = BROKEN_AFTER): 'OK' | 'Not checked' | 'Failing' | 'Broken' {
  if (f.consecutiveFailures === 0) return f.lastFetchedAt ? 'OK' : 'Not checked';
  return f.consecutiveFailures >= brokenAfter ? 'Broken' : 'Failing';
}

/**
 * What to do: give the feed a new address (it moved, or the address isn't a
 * feed), or wait while we keep trying (the trouble is on the site's end).
 */
export type Fix = 'address' | 'wait';
export type Diagnosis = { title: string; text: string; fix: Fix };

export function diagnose(f: { lastStatus: number | null; lastError: string | null }, site: string): Diagnosis {
  const s = f.lastStatus ?? Number(/^HTTP (\d+)/.exec(f.lastError ?? '')?.[1] ?? 0);
  const e = f.lastError ?? '';
  if (s === 404 || s === 410) return { title: 'This address no longer has a feed', text: `${site} says there’s nothing here. The feed may have moved.`, fix: 'address' };
  if (s === 401 || s === 403) return { title: `${site} is blocking feed readers`, text: 'We’ll keep trying in case that changes.', fix: 'wait' };
  if (s === 429) return { title: `${site} asked us to slow down`, text: 'We’ll try again later.', fix: 'wait' };
  if (s >= 500) return { title: `${site} is having trouble`, text: 'The problem is on the site’s end. We’ll keep trying.', fix: 'wait' };
  if (/ENOTFOUND|EAI_AGAIN/.test(e)) return { title: `There’s no site at ${site} anymore`, text: 'If the site moved, give the feed its new address. If it’s gone, remove the feed.', fix: 'address' };
  if (/timeout|aborted/i.test(e)) return { title: `${site} isn’t answering in time`, text: 'It may be down or overloaded. We’ll keep trying.', fix: 'wait' };
  if (/CERT|SSL|TLS/i.test(e)) return { title: `${site}’s security certificate is broken`, text: 'We can’t connect safely until the site fixes it. We’ll keep trying.', fix: 'wait' };
  if (/too large/i.test(e)) return { title: 'This feed is too large', text: 'The site sends more than we can read at once. A smaller feed from the same site may work.', fix: 'address' };
  if (/fetch failed|ECONN|EHOSTUNREACH|ENETUNREACH|socket/i.test(e)) return { title: `We can’t connect to ${site}`, text: 'It may be down. We’ll keep trying.', fix: 'wait' };
  if (/Unrecognized feed format|not closed|parse|XML/i.test(e)) return { title: 'This address isn’t a feed', text: `${site} sends something we can’t read as a feed. The feed may have moved.`, fix: 'address' };
  return { title: 'The last check failed', text: e || (s ? `${site} answered with an error (${s}).` : 'We couldn’t tell why.'), fix: 'address' };
}

/** One check's result in a few words, for the check history: "Not found (404)", not a bare "HTTP 404". */
export function checkLabel(c: { status: number | null; error: string | null; itemsNew: number | null }): string {
  const e = c.error ?? '';
  const s = c.status ?? Number(/^HTTP (\d+)/.exec(e)?.[1] ?? 0);
  if (!e) return s === 304 ? 'No change' : c.itemsNew ? `OK · ${c.itemsNew.toLocaleString()} new` : 'OK';
  if (s === 404 || s === 410) return `Not found (${s})`;
  if (s === 401 || s === 403) return `Blocked (${s})`;
  if (s === 429) return 'Asked to slow down (429)';
  if (s >= 500) return `Site trouble (${s})`;
  if (/ENOTFOUND|EAI_AGAIN/.test(e)) return 'No such site';
  if (/timeout|aborted/i.test(e)) return 'Timed out';
  if (/CERT|SSL|TLS/i.test(e)) return 'Bad certificate';
  if (/too large/i.test(e)) return 'Too large';
  if (/fetch failed|ECONN|EHOSTUNREACH|ENETUNREACH|socket/i.test(e)) return 'Couldn’t connect';
  if (/Unrecognized feed format|not closed|parse|XML/i.test(e)) return 'Not a feed';
  return e;
}
