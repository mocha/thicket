/**
 * Grouping sites by network, and pausing a shared host as one. No network, no
 * database: DNS and the ASN lookup are stand-ins, and hosts.ts is told to keep
 * its pauses in memory.
 * Run with `pnpm --filter @thicket/api test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { cymruName, groupKey, isNetworkKey, NetworkMap, networkShouldPause, NETWORK_WINDOW_MS, parseCymru, prefixKey } from "./networks.js";

// hosts.ts loads the database client, which only needs an address to exist; nothing here connects.
process.env.DATABASE_URL ??= "postgres://unused/unused";
const { afterResponse, awaitTurn, carefulNetwork, HostCoolingDown, useInMemoryHostsForTests } = await import("./hosts.js");
const { httpGet } = await import("./http.js");

test("address blocks: the /24, the /48, and IPv4 inside IPv6", () => {
  assert.equal(prefixKey("69.163.152.10"), "69.163.152.0/24");
  assert.equal(prefixKey("2001:db8:1:2::5"), "2001:db8:1::/48");
  assert.equal(prefixKey("2001:0db8:0000:0000::1"), "2001:db8:0::/48");
  assert.equal(prefixKey("::ffff:69.163.152.10"), "69.163.152.0/24");
  assert.equal(prefixKey("not an address"), null);
});

test("asks Team Cymru the right name, and reads its answer", () => {
  assert.equal(cymruName("69.163.152.10"), "10.152.163.69.origin.asn.cymru.com");
  assert.equal(cymruName("2001:db8::1"), `1.${"0.".repeat(23)}8.b.d.0.1.0.0.2.origin6.asn.cymru.com`);
  assert.equal(parseCymru([["26347 | 69.163.128.0/17 | US | arin | 2006-04-26"]]), 26347);
  assert.equal(parseCymru([["13335 209242 | 104.16.0.0/13 | US | arin | 2014-03-28"]]), 13335);
  assert.equal(parseCymru([]), null);
});

test("a shared host is one network; a CDN's customers are grouped only by address block", () => {
  assert.equal(groupKey("69.163.152.10", 26347), "AS26347");
  assert.equal(groupKey("104.21.32.1", 13335), "104.21.32.0/24");
  assert.equal(groupKey("185.199.108.153", 36459), "185.199.108.0/24");
  assert.equal(groupKey("192.0.2.7", null), "192.0.2.0/24");
  assert.equal(groupKey("162.158.1.1", 209242), "162.158.1.0/24", "Cloudflare's other ASN is a platform too");
  assert.equal(groupKey("23.227.38.65", 26496), "AS26496", "a genuine shared host (GoDaddy) stays one network");
  for (const k of ["AS26347", "192.0.2.0/24", "2001:db8:1::/48"]) assert.ok(isNetworkKey(k), k);
  for (const k of ["reddit.com", "as26347.example", "192.0.2.7", "localhost"]) assert.ok(!isNetworkKey(k), k);
});

test("platforms that crowd unrelated customers onto a few addresses give no network at all", () => {
  assert.equal(groupKey("192.0.78.12", 2635), null, "WordPress.com: 2,220 feeds in one /24");
  assert.equal(groupKey("198.185.159.144", 53831), null, "Squarespace");
  assert.equal(groupKey("198.51.233.1", 395409), null, "Neocities");
  assert.equal(groupKey("216.24.57.1", 397273), null, "Render");
});

test("one site limited is its own business; a second site within the window is the provider's", () => {
  const recent = new Map<string, number>();
  const t = 1_000_000_000;
  assert.equal(networkShouldPause(recent, "a.example", t, false), false);
  assert.equal(networkShouldPause(recent, "a.example", t + 1000, false), false, "the same site again is still one site");
  assert.equal(networkShouldPause(recent, "b.example", t + 2000, false), true);

  const later = new Map<string, number>();
  networkShouldPause(later, "a.example", t, false);
  assert.equal(networkShouldPause(later, "b.example", t + NETWORK_WINDOW_MS + 1, false), false, "too far apart to be one limit");

  assert.equal(networkShouldPause(new Map(), "a.example", t, true), true, "a careful network pauses on the first");
});

test("lookups are cached, and a failed one falls back or retries sooner", async () => {
  let now = 0;
  let lookups = 0;
  let asns = 0;
  const map = new NetworkMap({
    lookup: async (h) => {
      lookups++;
      if (h === "gone.example") throw new Error("ENOTFOUND");
      return h === "wp.example" ? "192.0.78.12" : h === "a.example" ? "69.163.152.10" : "69.163.152.11";
    },
    asn: async (ip) => { asns++; return ip.startsWith("69.163.") ? 26347 : ip.startsWith("192.0.78.") ? 2635 : null; },
    now: () => now,
  });
  assert.equal(map.cached("a.example"), null, "nothing known before the first lookup");
  assert.equal(await map.of("a.example"), "AS26347");
  assert.equal(map.cached("a.example"), "AS26347");
  assert.equal(await map.of("b.example"), "AS26347");
  assert.equal(await map.of("a.example"), "AS26347");
  assert.equal(lookups, 2, "one lookup per name");
  assert.equal(asns, 1, "one ASN lookup per /24");
  assert.equal(await map.of("gone.example"), null);
  assert.equal(await map.of("192.0.2.7"), "192.0.2.0/24", "an address needs no lookup, and an unknown ASN falls back to the block");
  assert.equal(await map.of("wp.example"), null, "a single-site platform has no network");
  now += 30 * 60_000;
  await map.of("wp.example");
  await map.of("gone.example");
  assert.equal(lookups, 5, "having no network is an answer, kept the hour; a failed lookup is retried after ten minutes");
  now += 2 * 3600_000;
  await map.of("a.example");
  assert.equal(lookups, 6, "names are looked up again after an hour");
  assert.equal(asns, 3, "address blocks are remembered for a day");
});

// Two DreamHost customers, two customers of an unknown host in one /24, two Cloudflare customers in different /24s.
const ADDRESSES: Record<string, string> = {
  "blog-one.example": "69.163.152.10", "blog-two.example": "69.163.200.20", "blog-three.example": "69.163.250.30",
  "x.example": "192.0.2.1", "y.example": "192.0.2.2", "z.example": "192.0.2.3",
  "cf-one.example": "104.21.1.1", "cf-two.example": "104.21.2.2", "cf-three.example": "104.21.3.3",
};
const ASNS: Record<string, number> = { "69.163": 26347, "104.21": 13335, "192.0": 64500 };
const fakeDns = {
  lookup: async (h: string) => ADDRESSES[h] ?? Promise.reject(new Error("ENOTFOUND")),
  asn: async (ip: string) => ASNS[ip.split(".").slice(0, 2).join(".")] ?? null,
};
const slowDown = new Headers({ "retry-after": "300" });

test("two sites on one network told to slow down pause all of its sites", async () => {
  useInMemoryHostsForTests(fakeDns);
  const x = await awaitTurn("https://x.example/feed");
  assert.equal(x.network, "AS64500");
  await afterResponse(x, 429, slowDown);
  // One site's 429 leaves its neighbours alone.
  const y = await awaitTurn("https://y.example/feed");
  await afterResponse(y, 429, slowDown);
  // The second makes it the provider's: a third site, never limited itself, waits too.
  await assert.rejects(awaitTurn("https://z.example/feed"), (e: unknown) => {
    assert.ok(e instanceof HostCoolingDown);
    assert.match(e.message, /^z\.example is on a shared host that asked thicket to slow down; thicket will try again in about 5 minutes\.$/);
    return true;
  });
  assert.equal(carefulNetwork("https://z.example/feed"), "AS64500", "and the network stays careful after");
});

test("a CDN customer's 429 does not pause other customers", async () => {
  useInMemoryHostsForTests(fakeDns);
  const one = await awaitTurn("https://cf-one.example/feed");
  assert.equal(one.network, "104.21.1.0/24");
  await afterResponse(one, 429, slowDown);
  const two = await awaitTurn("https://cf-two.example/feed");
  await afterResponse(two, 429, slowDown);
  const three = await awaitTurn("https://cf-three.example/feed");
  assert.equal(three.network, "104.21.3.0/24");
  assert.equal(carefulNetwork("https://cf-three.example/feed"), null);
});

test("a known shared host is careful from the start: one 429 pauses it, and requests to it are spaced", async () => {
  useInMemoryHostsForTests(fakeDns);
  const one = await awaitTurn("https://blog-one.example/feed");
  assert.equal(one.network, "AS26347");
  assert.equal(carefulNetwork("https://blog-two.example/feed"), null, "not known until looked up");
  one.release();
  const started = Date.now();
  const two = await awaitTurn("https://blog-two.example/feed");
  assert.ok(Date.now() - started >= 900, "a different site on the same shared host still waited its turn");
  assert.equal(carefulNetwork("https://blog-two.example/feed"), "AS26347");
  await afterResponse(two, 429, slowDown);
  two.release();
  await assert.rejects(awaitTurn("https://blog-three.example/feed"), HostCoolingDown);
});

const settled = async (p: Promise<unknown>) => {
  let done = false;
  p.then(() => { done = true; }, () => { done = true; });
  await sleep(0);
  return done;
};

test("one request at a time to a careful network, however long the first one takes", async () => {
  useInMemoryHostsForTests(fakeDns);
  const one = await awaitTurn("https://blog-one.example/feed");
  const two = awaitTurn("https://blog-two.example/feed");
  const three = awaitTurn("https://blog-three.example/feed");
  // Well past the one-second gap: the first request is still in flight, so nothing else starts.
  await sleep(1_500);
  assert.equal(await settled(two), false, "the second waits while the first is in flight");
  assert.equal(await settled(three), false);
  one.release();
  const t2 = await two;
  assert.equal(await settled(three), false, "the third waits for the second in turn");
  t2.release();
  t2.release(); // twice is harmless: it doesn't let a fourth in alongside the third
  const t3 = await three;
  const four = awaitTurn("https://blog-one.example/feed");
  await sleep(1_200);
  assert.equal(await settled(four), false);
  t3.release();
  (await four).release();
});

test("a CDN or unknown network is not held to one at a time", async () => {
  useInMemoryHostsForTests(fakeDns);
  const one = await awaitTurn("https://cf-one.example/feed");
  const x = await awaitTurn("https://x.example/feed");
  const y = await awaitTurn("https://y.example/feed");
  for (const t of [one, x, y]) t.release();
});

test("waiting too long for a careful network is refused as busy, and leaves the queue clean", async () => {
  useInMemoryHostsForTests(fakeDns, 300);
  const one = await awaitTurn("https://blog-one.example/feed");
  await assert.rejects(awaitTurn("https://blog-two.example/feed"), (e: unknown) => {
    assert.ok(e instanceof HostCoolingDown);
    assert.match(e.message, /already has requests queued/);
    return true;
  });
  one.release();
  // The refused waiter is gone: the network is free again rather than handed to nobody.
  await sleep(1_000);
  const again = await awaitTurn("https://blog-three.example/feed");
  again.release();
  useInMemoryHostsForTests(fakeDns);
});

test("a site that doesn't resolve is still fetched, by its host alone", async () => {
  useInMemoryHostsForTests(fakeDns);
  const t = await awaitTurn("https://nowhere.example/feed");
  assert.equal(t.host, "nowhere.example");
  assert.equal(t.network, null);
  await afterResponse(t, 429, slowDown);
  t.release();
  await assert.rejects(awaitTurn("https://nowhere.example/feed"), HostCoolingDown);
});

test("httpGet holds a careful network until the body is read, and lets go when the request fails", async () => {
  useInMemoryHostsForTests(fakeDns);
  const realFetch = globalThis.fetch;
  const events: string[] = [];
  let inFlight = 0;
  let most = 0;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const host = new URL(String(input)).hostname;
    events.push(`start ${host}`);
    inFlight++;
    most = Math.max(most, inFlight);
    if (host === "blog-two.example") { inFlight--; events.push(`end ${host}`); throw new TypeError("fetch failed"); }
    // Headers at once, the body slowly: longer than the one-second gap.
    const body = new ReadableStream<Uint8Array>({
      async start(c) {
        await sleep(host === "blog-one.example" ? 1_500 : 10);
        c.enqueue(new TextEncoder().encode("<rss/>"));
        inFlight--;
        events.push(`end ${host}`);
        c.close();
      },
    });
    return new Response(body, { status: 200, headers: { "content-type": "application/rss+xml" } });
  }) as typeof fetch;
  try {
    const results = await Promise.allSettled([
      httpGet("https://blog-one.example/feed"),
      httpGet("https://blog-two.example/feed"),
      httpGet("https://blog-three.example/feed"),
    ]);
    assert.equal(results[0].status, "fulfilled");
    assert.equal(results[1].status, "rejected");
    assert.equal(results[2].status, "fulfilled", "a failed request still let the next one go");
    assert.equal(most, 1, `never two in flight: ${events.join(", ")}`);
    assert.deepEqual(events, ["start blog-one.example", "end blog-one.example", "start blog-two.example", "end blog-two.example", "start blog-three.example", "end blog-three.example"]);
  } finally {
    globalThis.fetch = realFetch;
  }
});
