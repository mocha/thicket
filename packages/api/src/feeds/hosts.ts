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
 *
 * And a fourth, because some servers are run for thousands of domains at once:
 *
 * 4. **When a shared host says slow down, all of its sites wait.** Shared
 *    hosting limits by our address across every customer it has: in the Kagi
 *    survey every 429 came from DreamHost, each on a different customer's
 *    domain, and pausing one domain never slowed the next. So each site also
 *    has a network (feeds/networks.ts: the provider's ASN, or the /24 for big
 *    CDNs and clouds whose customers are unrelated). A network that limits
 *    across sites becomes *careful* for a day: one 429 from any site on it
 *    pauses all of them, and whichever site they are for, its requests go one
 *    at a time (a request holds the network until its response has been read:
 *    Turn.release) and start at least NETWORK_GAP_MS apart. A network becomes
 *    careful when two
 *    different sites on it are limited within half an hour, or from the start
 *    for shared hosts we already know (SHARED_HOSTS). One site's own 429 never
 *    pauses its neighbours on a CDN, and a network that has never limited us
 *    is not slowed at all. Network pauses are kept in host_cooldowns too,
 *    keyed "AS26347" or "203.0.113.0/24".
 */
import { setTimeout as sleep } from "node:timers/promises";
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { NetworkMap, SHARED_HOSTS, isNetworkKey, networkShouldPause, realDeps, type NetworkDeps } from "./networks.js";

const DEFAULT_GAP_MS = 750;
const GAP_MS: Record<string, number> = { "reddit.com": 7_000 };
/** A request that would queue longer than this is refused as "busy" and rescheduled instead. */
const MAX_QUEUE_MS = 90_000;
let maxQueueMs = MAX_QUEUE_MS;

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

/**
 * Minimum gap between the starts of requests to a careful network, whichever of
 * its sites they are for. The survey's DreamHost retry went through cleanly at
 * three in flight; one start a second is well inside that.
 */
const NETWORK_GAP_MS = 1_000;
/** How long a network stays careful after it last paused us. */
const CAREFUL_MS = 24 * 3600_000;

type NetState = {
  nextSlot: number;
  until: number;
  reason: string | null;
  /** Network pauses while careful; drives the doubling default. Starts over once it stops being careful. */
  strikes: number;
  /** Careful until (ms epoch): paced and paused as one. */
  carefulUntil: number;
  /** Sites on it told to slow down recently, and when. */
  limited: Map<string, number>;
  /** A request to it is in flight (careful networks only); others wait in `waiters`, first come first served. */
  busy: boolean;
  waiters: (() => void)[];
};

const hosts = new Map<string, HostState>();
const nets = new Map<string, NetState>();
let networks = new NetworkMap();
/** Off in tests: keep everything in memory. */
let remember = true;
const log = (m: string) => console.log(`[polite] ${m}`);

function netState(key: string): NetState {
  let n = nets.get(key);
  if (!n) {
    n = { nextSlot: 0, until: 0, reason: null, strikes: 0, carefulUntil: 0, limited: new Map(), busy: false, waiters: [] };
    nets.set(key, n);
  }
  return n;
}

const isCareful = (key: string, n: NetState, now: number) => SHARED_HOSTS.has(key) || n.carefulUntil > now;

/**
 * Take the network's one in-flight place, waiting up to `ms` for it. False when
 * the wait ran out. On release the place goes straight to the next waiter.
 */
function acquire(n: NetState, ms: number): Promise<boolean> {
  if (!n.busy) { n.busy = true; return Promise.resolve(true); }
  return new Promise((resolve) => {
    const take = () => { clearTimeout(timer); resolve(true); };
    const timer = setTimeout(() => {
      n.waiters.splice(n.waiters.indexOf(take), 1);
      resolve(false);
    }, ms);
    n.waiters.push(take);
  });
}

/** Give the place back, once only however often it is called. */
function releaser(n: NetState): () => void {
  let done = false;
  return () => {
    if (done) return;
    done = true;
    const next = n.waiters.shift();
    if (next) next(); else n.busy = false;
  };
}

/**
 * The careful network this URL's site is on, if it is on one and we already know
 * which (no lookup: this is for the scheduler's loop). awaitTurn keeps careful
 * networks to one request at a time for every caller; the scheduler and the
 * importer also check this so that a feed doesn't hold one of their slots while
 * it waits there. On first contact the network isn't known yet, and awaitTurn
 * alone keeps it to one at a time.
 */
export function carefulNetwork(url: string): string | null {
  const key = networks.cached(hostnameOf(url));
  return key && isCareful(key, netState(key), Date.now()) ? key : null;
}

function hostnameOf(url: string): string {
  try { return new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, ""); } catch { return ""; }
}

/**
 * Tests only: forget every host and network, never touch the database, and
 * resolve networks with the given functions instead of real DNS.
 */
export function useInMemoryHostsForTests(deps: Partial<NetworkDeps> = {}, queueMs = MAX_QUEUE_MS) {
  maxQueueMs = queueMs;
  hosts.clear();
  nets.clear();
  loaded = Promise.resolve();
  remember = false;
  networks = new NetworkMap({ ...realDeps, ...deps });
}

export class HostCoolingDown extends Error {
  constructor(readonly host: string, readonly until: Date, readonly reason: string) {
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
      const stale: string[] = [];
      for (const r of rows.rows) {
        if (isNetworkKey(r.host)) {
          // A network row outlives its pause: it is also the record that the network is careful, for a day after.
          const until = new Date(r.until).getTime();
          if (until + CAREFUL_MS < Date.now()) { stale.push(r.host); continue; }
          const n = netState(r.host);
          n.until = until;
          n.reason = r.reason;
          n.strikes = r.strikes;
          n.carefulUntil = until + CAREFUL_MS;
          continue;
        }
        const s = state(r.host);
        s.until = new Date(r.until).getTime();
        s.reason = r.reason;
        s.strikes = r.strikes;
        s.outageStrikes = r.outage_strikes;
        s.wasPaused = true;
      }
      for (const key of stale) await db.execute(sql`delete from host_cooldowns where host = ${key}`);
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

/**
 * Whose turn a request took: its host, and its network when the site's address
 * is known. The caller must call `release` once the response has been read, or
 * the request has failed in any way: on a careful network the next request
 * waits for it. Calling it twice is harmless.
 */
export type Turn = { host: string; network: string | null; release: () => void };

/**
 * Why a host is paused or refused, as stored in host_cooldowns.reason and
 * carried on HostCoolingDown. feeds/explain.ts words each one for a person.
 */
export const PAUSE_REASONS = {
  slowDown: "asked thicket to slow down",
  unavailable: "said it is temporarily unavailable",
  outage: "seems to be down",
  network: "is on a shared host that asked thicket to slow down",
  queued: "already has requests from thicket queued",
  networkQueued: "is on a shared host thicket already has requests queued for",
} as const;
const NETWORK_REASON = PAUSE_REASONS.network;

/**
 * Wait for this host's turn, and its network's when the network is careful:
 * then the request also holds the network, so no other request to any of its
 * sites starts until this one is released. Throws HostCoolingDown when either is
 * paused or the wait would be too long.
 */
export async function awaitTurn(url: string): Promise<Turn> {
  await loadHosts();
  const key = hostKey(url);
  const s = state(key);
  // Before anything is reserved, so the checks and reservations below happen without a pause in between.
  const network = await networks.of(hostnameOf(url));
  const n = network ? netState(network) : null;
  const notPaused = () => {
    const now = Date.now();
    if (s.until > now) throw new HostCoolingDown(key, new Date(s.until), s.reason ?? PAUSE_REASONS.slowDown);
    if (n && n.until > now) throw new HostCoolingDown(key, new Date(n.until), NETWORK_REASON);
  };
  notPaused();
  let held: NetState | null = null;
  let release = () => {};
  if (n && isCareful(network!, n, Date.now())) {
    if (!(await acquire(n, maxQueueMs))) throw new HostCoolingDown(key, new Date(Date.now() + 60_000), PAUSE_REASONS.networkQueued);
    held = n;
    release = releaser(n);
  }
  try {
    // A pause can begin while we queue.
    notPaused();
    const now = Date.now();
    const slot = Math.max(now, s.nextSlot, held?.nextSlot ?? 0);
    if (slot - now > maxQueueMs) throw new HostCoolingDown(key, new Date(slot), PAUSE_REASONS.queued);
    s.nextSlot = slot + (GAP_MS[key] ?? DEFAULT_GAP_MS);
    if (held) held.nextSlot = slot + NETWORK_GAP_MS;
    if (slot > now) await sleep(slot - now);
    notPaused();
    return { host: key, network, release };
  } catch (e) {
    release();
    throw e;
  }
}

/**
 * Read what a response says about the host itself. Pauses it on 429, or on 503
 * with Retry-After, and the whole network too when that is the second site on
 * it to say so lately, or the network is careful.
 */
export async function afterResponse(turn: Turn, status: number, headers: Headers): Promise<void> {
  const retryAfter = headers.get("retry-after");
  if (!(status === 429 || (status === 503 && retryAfter))) return;
  const key = turn.host;
  const s = state(key);
  s.strikes++;
  const hinted = parseRetryAfter(retryAfter);
  const fallback = DEFAULT_PAUSE_MS * 2 ** Math.min(s.strikes - 1, 8);
  const wait = Math.min(MAX_PAUSE_MS, Math.max(MIN_PAUSE_MS, hinted ?? fallback));
  const reason = status === 429 ? PAUSE_REASONS.slowDown : PAUSE_REASONS.unavailable;
  const detail = `HTTP ${status}${retryAfter ? `, Retry-After ${retryAfter}` : ", no Retry-After"}`;
  await pause(key, s, Date.now() + wait, reason, detail);
  if (turn.network) await networkLimited(turn.network, key, hinted, detail);
}

async function networkLimited(network: string, site: string, hinted: number | null, detail: string) {
  const n = netState(network);
  const now = Date.now();
  const careful = isCareful(network, n, now);
  if (!networkShouldPause(n.limited, site, now, careful)) return;
  if (!careful) n.strikes = 0;
  n.strikes++;
  const fallback = DEFAULT_PAUSE_MS * 2 ** Math.min(n.strikes - 1, 8);
  const until = Math.max(n.until, now + Math.min(MAX_PAUSE_MS, Math.max(MIN_PAUSE_MS, hinted ?? fallback)));
  n.until = until;
  n.reason = NETWORK_REASON;
  n.carefulUntil = until + CAREFUL_MS;
  const sites = [...n.limited.keys()];
  log(`${network} paused until ${new Date(until).toISOString()}: shared host, ${sites.length} of its sites limited lately (${sites.slice(0, 3).join(", ")}${sites.length > 3 ? ", …" : ""}; last ${site}: ${detail})`);
  // Its feeds are not moved here: which feeds are on a network is only known by
  // resolving them. Each one that comes due meets the pause in awaitTurn instead,
  // without a request, and is put back past it (feeds/refresh.ts).
  if (!remember) return;
  try {
    await db.execute(sql`
      insert into host_cooldowns (host, until, reason, strikes, outage_strikes) values (${network}, ${new Date(until)}, ${n.reason}, ${n.strikes}, 0)
      on conflict (host) do update set until = excluded.until, reason = excluded.reason, strikes = excluded.strikes, updated_at = now()`);
  } catch (e) {
    log(`could not save pause for ${network}: ${e}`);
  }
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
  await pause(key, s, Date.now() + wait, PAUSE_REASONS.outage, `${n} of its feeds in a row failed with ${failure}`);
}

async function pause(key: string, s: HostState, untilMs: number, reason: string, detail: string) {
  s.until = untilMs;
  s.reason = reason;
  s.wasPaused = true;
  const until = new Date(untilMs);
  log(`${key} paused until ${until.toISOString()}: ${reason} (${detail})`);
  if (!remember) return;
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
  if (!remember) return;
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
