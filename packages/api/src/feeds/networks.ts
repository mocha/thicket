/**
 * Which network a site lives on, so politeness can span sites that share one
 * (feeds/hosts.ts). A "host" there is a registrable domain, and that is right
 * for most rate limits: whoever runs reddit.com limits reddit.com. Shared
 * hosting is the exception. A shared host limits by *our* address across all
 * of its customers, so a thousand personal blogs on a thousand domains are, to
 * its rate limiter, one site. The Kagi survey (2026-09-16) found exactly this:
 * every 429 came from DreamHost (AS26347), `Retry-After: 300`, each on a
 * different customer's domain. Pausing per domain never slowed the next
 * DreamHost customer, so the limit kept firing.
 *
 * So each site is also given a network, from the address its name resolves to:
 *
 * - **The autonomous system (ASN)** that announces the address, looked up over
 *   DNS from Team Cymru's free IP-to-ASN service (`origin.asn.cymru.com`). An
 *   ASN is the provider: all of DreamHost is AS26347, however many address
 *   blocks its servers sit in. One lookup per /24, remembered for a day.
 * - **The /24 (IPv4) or /48 (IPv6)** instead, for the big platforms whose
 *   customers have nothing to do with each other: CDNs (Cloudflare, Fastly,
 *   Akamai), clouds and VPS providers (AWS, Google, Hetzner, DigitalOcean…),
 *   GitHub Pages. Grouping all of Cloudflare as one "site" would collapse a
 *   large share of the web into one slow queue, and Cloudflare does not limit
 *   one customer for another's sake. The /24 is also the fallback whenever the
 *   ASN lookup fails, so a Cymru outage costs precision, not politeness.
 *
 * Being in a group costs nothing by itself. hosts.ts only acts on a network
 * once it has shown that it limits across sites (two different sites on it
 * told us to slow down within half an hour), or when it is a shared host we
 * already know does (SHARED_HOSTS). See there for what it does then.
 *
 * The DNS here is a lookup of the site's name, which fetch() was about to do
 * anyway, and one small TXT query per address block. No HTTP, nothing a site
 * sees. Everything is cached in memory; a restart only means looking up again.
 */
import { lookup as dnsLookup, Resolver } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Shared hosts known to limit by client address across their customers, so
 * thicket is careful with them from the first request rather than after the
 * first two 429s. Evidence-based: add one when its 429s turn up in logs.
 */
export const SHARED_HOSTS = new Set<string>([
  "AS26347", // DreamHost (New Dream Network): the Kagi survey, 2026-09-16
]);

/**
 * Platforms hosting unrelated customers at scale, grouped by /24 instead of by
 * ASN. Without this, one rate-limited Cloudflare customer plus one more would
 * slow every Cloudflare site thicket follows.
 */
const PLATFORMS = new Set<number>([
  13335, // Cloudflare
  54113, // Fastly
  20940, 16625, // Akamai
  16509, 14618, // Amazon
  15169, 396982, // Google, Google Cloud
  8075, // Microsoft
  36459, // GitHub (Pages)
  2635, // Automattic (WordPress.com)
  14061, // DigitalOcean
  24940, // Hetzner
  16276, // OVH
  63949, // Linode
  20473, // Vultr
  31898, // Oracle Cloud
]);

const HOST_TTL_MS = 3600_000;
const ASN_TTL_MS = 24 * 3600_000;
/** A failed lookup is retried sooner than a good one is refreshed. */
const MISS_TTL_MS = 10 * 60_000;
const LOOKUP_TIMEOUT_MS = 5_000;
/** Plenty for every site thicket follows; past it the cache starts over rather than growing forever. */
const MAX_ENTRIES = 50_000;

/** "203.0.113.0/24", or "2001:db8:1::/48". Null when it isn't an address. */
export function prefixKey(ip: string): string | null {
  const v = isIP(ip);
  if (v === 4) return `${ip.split(".").slice(0, 3).join(".")}.0/24`;
  if (v !== 6) return null;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return prefixKey(mapped[1]);
  return `${expand6(ip).slice(0, 3).map((g) => g.replace(/^0+(?=.)/, "")).join(":")}::/48`;
}

/** The eight four-digit groups of an IPv6 address. */
function expand6(ip: string): string[] {
  let s = ip.toLowerCase();
  // A dotted IPv4 tail ("::1.2.3.4") is the last two groups.
  const tail = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(s);
  if (tail) {
    const [a, b, c, d] = tail.slice(1).map(Number);
    s = s.slice(0, tail.index) + `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, rest] = s.split("::");
  const left = head ? head.split(":") : [];
  const right = rest !== undefined && rest ? rest.split(":") : [];
  const fill = rest === undefined ? [] : Array(8 - left.length - right.length).fill("0");
  return [...left, ...fill, ...right].map((g) => g.padStart(4, "0"));
}

/** The Team Cymru name to ask for an address's origin ASN. */
export function cymruName(ip: string): string | null {
  const v = isIP(ip);
  if (v === 4) return `${ip.split(".").reverse().join(".")}.origin.asn.cymru.com`;
  if (v !== 6) return null;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return cymruName(mapped[1]);
  return `${expand6(ip).join("").split("").reverse().join(".")}.origin6.asn.cymru.com`;
}

/** The ASN from a Cymru TXT answer: "26347 | 69.163.128.0/17 | US | arin | 2006-04-26". A block announced by several takes the first. */
export function parseCymru(records: string[][]): number | null {
  const first = records[0]?.join("");
  const asn = first ? /^\s*(\d+)/.exec(first)?.[1] : undefined;
  return asn ? Number(asn) : null;
}

/** The network key for an address: "AS26347" for most, the /24 for the big platforms or when the ASN is unknown. */
export function groupKey(ip: string, asn: number | null): string | null {
  return asn !== null && !PLATFORMS.has(asn) ? `AS${asn}` : prefixKey(ip);
}

/** Network keys never collide with hostKey()s: those never contain "/", and are lower-case. */
export const isNetworkKey = (key: string) => key.includes("/") || /^AS\d+$/.test(key);

export const NETWORK_WINDOW_MS = 30 * 60_000;
/** Different sites on one network told to slow down within the window before the network counts as limiting us as a whole. */
export const NETWORK_SPREAD = 2;

/**
 * Note that `site` on a network was just told to slow down, and say whether the
 * whole network should now pause. A careful network pauses on the first one; any
 * other only once a second, different site on it has been limited within the
 * window. One site's own limit is that site's business; two is the provider.
 * `recent` is the network's memory of limited sites and when, pruned here.
 */
export function networkShouldPause(recent: Map<string, number>, site: string, now: number, careful: boolean): boolean {
  for (const [k, at] of recent) if (now - at > NETWORK_WINDOW_MS) recent.delete(k);
  recent.set(site, now);
  return careful || recent.size >= NETWORK_SPREAD;
}

export type NetworkDeps = {
  /** A hostname's address. Rejects when it has none. */
  lookup: (hostname: string) => Promise<string>;
  /** The ASN announcing an address, or null when unknown. */
  asn: (ip: string) => Promise<number | null>;
  now: () => number;
};

const cymru = new Resolver({ timeout: 2_000, tries: 1 });

export const realDeps: NetworkDeps = {
  lookup: (hostname) => {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("dns timeout")), LOOKUP_TIMEOUT_MS); timer.unref(); });
    return Promise.race([dnsLookup(hostname).then((r) => r.address), timeout]).finally(() => clearTimeout(timer));
  },
  asn: async (ip) => {
    const name = cymruName(ip);
    return name ? parseCymru(await cymru.resolveTxt(name).catch(() => [])) : null;
  },
  now: Date.now,
};

type Cached<T> = { expires: number; value: Promise<T>; settled?: T };

/** Hostname → network key, with the lookups behind it cached. */
export class NetworkMap {
  private byHost = new Map<string, Cached<string | null>>();
  private byPrefix = new Map<string, Cached<number | null>>();
  constructor(private deps: NetworkDeps = realDeps) {}

  /** The network already known for this hostname, without looking anything up. */
  cached(hostname: string): string | null {
    const c = this.byHost.get(hostname);
    return c && c.expires > this.deps.now() ? c.settled ?? null : null;
  }

  /** This hostname's network key, or null when it doesn't resolve. Never throws. */
  of(hostname: string): Promise<string | null> {
    return this.remember(this.byHost, hostname, HOST_TTL_MS, async () => {
      const ip = isIP(hostname) ? hostname : await this.deps.lookup(hostname).catch(() => null);
      const prefix = ip && prefixKey(ip);
      if (!ip || !prefix) return null;
      const asn = await this.remember(this.byPrefix, prefix, ASN_TTL_MS, () => this.deps.asn(ip).catch(() => null));
      return groupKey(ip, asn);
    });
  }

  private remember<T>(map: Map<string, Cached<T | null>>, key: string, ttl: number, load: () => Promise<T | null>): Promise<T | null> {
    const now = this.deps.now();
    const hit = map.get(key);
    if (hit && hit.expires > now) return hit.value;
    if (map.size >= MAX_ENTRIES) map.clear();
    const entry: Cached<T | null> = { expires: now + ttl, value: load().catch(() => null) };
    entry.value.then((v) => {
      entry.settled = v;
      if (v === null) entry.expires = Math.min(entry.expires, this.deps.now() + MISS_TTL_MS);
    });
    map.set(key, entry);
    return entry.value;
  }
}
