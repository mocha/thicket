/**
 * Why adding a feed failed, in words for the person adding it. Everything the
 * Add a feed sheet shows after "Not followed" comes from here, so no raw error
 * text ("HTTP 404 fetching …", "fetch failed") reaches a reader. The original
 * error is still logged by the caller, for support.
 *
 * Each sentence says what happened and, where there is one, what to do next.
 * A status number stays in brackets at the end when it helps someone report it.
 */
import { HostCoolingDown, hostKey } from "./hosts.js";
import { BadStatus, MAX_BYTES, TooLargeError } from "./http.js";

/** A failure whose message was already written for a reader (feeds/youtube.ts). */
export class Explained extends Error {}

const SITE_NAMES: Record<string, string> = { "reddit.com": "Reddit", "youtube.com": "YouTube", "youtu.be": "YouTube" };

/** "Reddit" for the sites people know by name, otherwise the address: "example.com". */
function siteName(url: string): string {
  const host = hostKey(url);
  return SITE_NAMES[host] ?? host;
}

function forStatus(site: string, status: number): string {
  if (status === 404 || status === 410) return `${site} says there’s nothing at that address. Check it and try again.`;
  if (status === 401 || status === 403) return `${site} doesn’t let feed readers in, so thicket can’t follow it.`;
  if (status === 429) return `${site} is getting too many requests right now. Try again in a few minutes.`;
  if (status >= 500) return `${site} is having trouble right now. Try again later (${status}).`;
  return `${site} answered with an error (${status}).`;
}

export function explainAddFailure(err: unknown, url: string): string {
  const site = siteName(url);
  if (err instanceof Explained) return err.message;
  if (err instanceof HostCoolingDown) {
    const mins = Math.max(1, Math.round((err.until.getTime() - Date.now()) / 60_000));
    return `${siteName(`https://${err.host}`)} is limiting how often thicket can ask for its feeds. Try again in about ${mins} minute${mins === 1 ? "" : "s"}.`;
  }
  if (err instanceof BadStatus) return forStatus(site, err.status);
  const msg = String((err as { cause?: { code?: string } })?.cause?.code ?? (err instanceof Error ? `${err.name} ${err.message}` : err));
  if (err instanceof TooLargeError || /too large/i.test(msg)) return `This feed is too large for thicket to read (over ${MAX_BYTES / 1024 / 1024} MB).`;
  if (/ENOTFOUND|EAI_AGAIN/.test(msg)) return `There’s no site at ${site}. Check the spelling and try again.`;
  if (/timeout|TimeoutError|aborted/i.test(msg)) return `${site} didn’t answer in time. Try again in a minute.`;
  if (/CERT|SSL|TLS/i.test(msg)) return `${site}’s security certificate is broken, so thicket can’t connect to it safely.`;
  if (/ECONN|EHOSTUNREACH|ENETUNREACH|fetch failed|socket/i.test(msg)) return `thicket couldn’t connect to ${site}. It may be down. Try again later.`;
  return "Something went wrong on our side while adding this. Try again in a minute.";
}
