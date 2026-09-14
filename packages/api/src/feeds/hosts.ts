/**
 * Being a good guest, per host. Every request thicket makes to the open web
 * goes through httpGet, and httpGet asks this module first. Not getting
 * ourselves blocked by a site is a top priority: thicket is one server address
 * making thousands of requests a day, and 432 of its feeds sit on youtube.com.
 *
 * Three rules:
 *
 * 1. **Take turns.** One request at a time per host, with a minimum gap between
 *    the starts of consecutive requests (the scheduler also launches only one
 *    feed per host at a time). Reddit gets a longer gap: it allows unauthenticated
 *    clients about ten requests a minute, and answered 429 nineteen times in the
 *    four days before this existed.
 * 2. **When a host says slow down, the whole host waits.** A 429, or a 503 with
 *    Retry-After, pauses every request to that host — every feed, discovery,
 *    icons — until the time it named, or a doubling default when it named none.
 *    The host's feeds are rescheduled past the pause, spread out so they don't
 *    come back as one burst. Being told to wait is not a failing feed.
 * 3. **When many feeds on one host fail the same way in a row, the host is
 *    down, not the feeds.** YouTube's feed endpoint has gone all-404 for hours at
 *    a time (2026-09-12 and -13). Rather than booking hundreds of separate
 *    failures, pause the host and retry it as a whole. When a feed on it works
 *    again, feeds that had been pushed far out by their own backoff are pulled
 *    forward instead of staying parked for hours.
 *
 * A "host" is the registrable domain: www.reddit.com and old.reddit.com are one
 * host, and so are all the *.substack.com blogs, because a rate limit belongs to
 * whoever runs the servers. Pauses are written to host_cooldowns, so a redeploy
 * in the middle of one does not forget it.
 */
import { setTimeout as sleep } from "node:timers/promises";
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";

const DEFAULT_GAP_MS = 750;
const GAP_MS: Record<string, number> = { "reddit.com": 7_000 };
/** A request that would queue longer than this is refused as "busy" and rescheduled instead. */
const MAX_QUEUE_MS = 90_000;

const MIN_PAUSE_MS = 60_000;
const DEFAULT_PAUSE_MS = 10 * 60_000;
const MAX_PAUSE_MS = 12 * 3600_000;

/** Distinct feeds on one host failing the same way, back to back, before it counts as the host being down. */
const OUTAGE_FEEDS = 5;
const OUTAGE_PAUSE_MS = 15 * 60_000;
const MAX_OUTAGE_PAUSE_MS = 3 * 3600_000;

const SECOND_LEVEL = new Set(["co.uk", "org.uk", "ac.uk", "gov.uk", "me.uk", "com.au", "net.au", "org.au", "co.nz", "co.jp", "com.br", "co.za", "co.in", "com.mx", "co.kr", "com.tr"]);

type HostState = {
  /** Earliest time the next request may start. */
  nextSlot: number;
  /** Paused until (ms epoch); 0 = not paused. */
  until: number;
  reason: string | null;
  /** 429s in a row without a working fetch in between; drives the doubling default. */
  strikes: number;
  outageStrikes: number;
  /** Paused at some point since the last working fetch; the next one triggers recovery. */
  wasPaused: boolean;
  failSignature: string | null;
  failFeeds: Set<number>;
};

const hosts = new Map<string, HostState>();
const log = (m: string) => console.log(`[polite] ${m}`);

export class HostCoolingDown extends Error {
  constructor(readonly host: string, readonly until: Date, reason: string) {
    const mins = Math.max(1, Math.round((until.getTime() - Date.now()) / 60_000));
    super(`${host} ${reason}; thicket will try again in about ${mins} minute${mins === 1 ? "" : "s"}.`);
  }
}

export function hostKey(url: string): string {
  let h: string;
  try { h = new URL(url).hostname.toLowerCase(); } catch { return url; }
  if (/^[\d.]+$/.test(h) || h.includes(":")) return h;
  const parts = h.split(".");
  if (parts.length <= 2) return h;
  const last2 = parts.slice(-2).join(".");
  return SECOND_LEVEL.has(last2) ? parts.slice(-3).join(".") : last2;
}

function state(key: string): HostState {
  let s = hosts.get(key);
  if (!s) {
    s = { nextSlot: 0, until: 0, reason: null, strikes: 0, outageStrikes: 0, wasPaused: false, failSignature: null, failFeeds: new Set() };
    hosts.set(key, s);
  }
  return s;
}

let loaded: Promise<void> | null = null;
/** Pick up pauses and strike counts from before a restart. Safe to call often. */
export function loadHosts(): Promise<void> {
  return (loaded ??= (async () => {
    try {
      const rows = await db.execute<{ host: string; until: string; reason: string | null; strikes: number; outage_strikes: number }>(sql`
        select host, until, reason, strikes, outage_strikes from host_cooldowns`);
      for (const r of rows.rows) {
        const s = state(r.host);
        s.until = new Date(r.until).getTime();
        s.reason = r.reason;
        s.strikes = r.strikes;
        s.outageStrikes = r.outage_strikes;
        s.wasPaused = true;
      }
    } catch (e) {
      log(`could not load saved pauses: ${e}`);
    }
  })());
}

/** When this host's pause ends, or null if it isn't paused. */
export function coolingUntil(key: string): Date | null {
  const s = hosts.get(key);
  return s && s.until > Date.now() ? new Date(s.until) : null;
}

/** Wait for this host's turn. Throws HostCoolingDown when it is paused or the queue is too long. Returns the host key. */
export async function awaitTurn(url: string): Promise<string> {
  await loadHosts();
  const key = hostKey(url);
  const s = state(key);
  const now = Date.now();
  if (s.until > now) throw new HostCoolingDown(key, new Date(s.until), s.reason ?? "asked thicket to wait");
  const slot = Math.max(now, s.nextSlot);
  if (slot - now > MAX_QUEUE_MS) throw new HostCoolingDown(key, new Date(slot), "already has requests from thicket queued");
  s.nextSlot = slot + (GAP_MS[key] ?? DEFAULT_GAP_MS);
  if (slot > now) await sleep(slot - now);
  // A pause can begin while we queue.
  if (s.until > Date.now()) throw new HostCoolingDown(key, new Date(s.until), s.reason ?? "asked thicket to wait");
  return key;
}

/** Read what a response says about the host itself. Pauses it on 429, or on 503 with Retry-After. */
export async function afterResponse(key: string, status: number, headers: Headers): Promise<void> {
  const retryAfter = headers.get("retry-after");
  if (!(status === 429 || (status === 503 && retryAfter))) return;
  const s = state(key);
  s.strikes++;
  const hinted = parseRetryAfter(retryAfter);
  const fallback = DEFAULT_PAUSE_MS * 2 ** Math.min(s.strikes - 1, 8);
  const wait = Math.min(MAX_PAUSE_MS, Math.max(MIN_PAUSE_MS, hinted ?? fallback));
  const reason = status === 429 ? "asked thicket to slow down" : "said it is temporarily unavailable";
  await pause(key, s, Date.now() + wait, reason, `HTTP ${status}${retryAfter ? `, Retry-After ${retryAfter}` : ", no Retry-After"}`);
}

/**
 * How a feed fetch on this host went: null for a working fetch, otherwise a
 * short signature of the failure ("HTTP 404", "timeout"). Detects a host-wide
 * outage, and recovers from any pause on the first working fetch after it.
 */
export async function feedOutcome(url: string, feedId: number, failure: string | null): Promise<void> {
  await loadHosts();
  const key = hostKey(url);
  const s = state(key);
  if (failure === null) {
    s.failSignature = null;
    s.failFeeds.clear();
    if (s.wasPaused || s.strikes || s.outageStrikes) await recover(key, s);
    return;
  }
  if (s.failSignature !== failure) {
    s.failSignature = failure;
    s.failFeeds = new Set();
  }
  s.failFeeds.add(feedId);
  if (s.failFeeds.size < OUTAGE_FEEDS || s.until > Date.now()) return;
  s.outageStrikes++;
  const wait = Math.min(MAX_OUTAGE_PAUSE_MS, OUTAGE_PAUSE_MS * 2 ** Math.min(s.outageStrikes - 1, 8));
  const n = s.failFeeds.size;
  s.failFeeds.clear();
  await pause(key, s, Date.now() + wait, "seems to be down", `${n} of its feeds in a row failed with ${failure}`);
}

async function pause(key: string, s: HostState, untilMs: number, reason: string, detail: string) {
  s.until = untilMs;
  s.reason = reason;
  s.wasPaused = true;
  const until = new Date(untilMs);
  log(`${key} paused until ${until.toISOString()}: ${reason} (${detail})`);
  try {
    await db.execute(sql`
      insert into host_cooldowns (host, until, reason, strikes, outage_strikes) values (${key}, ${until}, ${reason}, ${s.strikes}, ${s.outageStrikes})
      on conflict (host) do update set until = excluded.until, reason = excluded.reason, strikes = excluded.strikes, outage_strikes = excluded.outage_strikes, updated_at = now()`);
    // Every feed on the host waits out the pause, then returns spread over ten minutes rather than all at once.
    await db.execute(sql`
      update feeds set next_fetch_at = ${until}::timestamptz + random() * interval '10 minutes'
      where next_fetch_at < ${until}::timestamptz and ${onHost(key)}`);
  } catch (e) {
    log(`could not save pause for ${key}: ${e}`);
  }
}

async function recover(key: string, s: HostState) {
  const hadPause = s.wasPaused;
  s.strikes = 0;
  s.outageStrikes = 0;
  s.wasPaused = false;
  s.until = 0;
  s.reason = null;
  try {
    await db.execute(sql`delete from host_cooldowns where host = ${key}`);
    if (!hadPause) return;
    // Feeds that failed during the trouble backed themselves off, some by hours. The host works again, so bring them back soon, spread out.
    const moved = await db.execute(sql`
      update feeds set next_fetch_at = now() + random() * interval '20 minutes'
      where consecutive_failures > 0 and next_fetch_at > now() + interval '20 minutes' and ${onHost(key)}`);
    log(`${key} is answering again; ${moved.rowCount ?? 0} parked feeds brought forward`);
  } catch (e) {
    log(`could not record recovery for ${key}: ${e}`);
  }
}

const onHost = (key: string) => sql`(split_part(url, '/', 3) = ${key} or split_part(url, '/', 3) like ${`%.${key}`})`;

function parseRetryAfter(v: string | null): number | null {
  if (!v) return null;
  const t = v.trim();
  if (/^\d+$/.test(t)) return Number(t) * 1000;
  const at = Date.parse(t);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null;
}
