/**
 * Adding a YouTube channel while its feed isn't answering. No network, no
 * database: YouTube is a stub, and hosts are kept in memory.
 * Run with `pnpm --filter @thicket/api test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

// These modules load the database client, which only needs an address to exist; nothing here connects.
process.env.DATABASE_URL ??= "postgres://unused/unused";
const { discover } = await import("./discover.js");
const { extractChannelTitle } = await import("./youtube.js");
const { HostCoolingDown, PAUSE_REASONS, useInMemoryHostsForTests } = await import("./hosts.js");
const { BadStatus } = await import("./http.js");

const ID = "UCbd-QOxzNKQifQfSuaH5I0A";
const FEED = `https://www.youtube.com/feeds/videos.xml?channel_id=${ID}`;
const channelPage = (title: string) =>
  `<html><head><meta property="og:title" content="${title.replace(/&/g, "&amp;")}"></head><body><script>{"channelMetadataRenderer":{"title":${JSON.stringify(title)},"externalId":"${ID}"}}</script></body></html>`;
const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Jack Conte Extras</title><id>x</id><updated>2026-10-01T00:00:00Z</updated><entry><title>v</title><id>1</id><link href="https://www.youtube.com/watch?v=abcdefghijk"/><updated>2026-10-01T00:00:00Z</updated></entry></feed>`;

const fakeDns = { lookup: async () => "142.250.0.1", asn: async () => 15169 };

/**
 * Answer each address from `routes` (a status, or a status and a body), and
 * record what was asked. An address not listed fails the test.
 */
async function withYouTube<T>(routes: Record<string, number | [number, string] | Error>, run: () => Promise<T>): Promise<{ result: T; asked: string[] }> {
  useInMemoryHostsForTests(fakeDns);
  const realFetch = globalThis.fetch;
  const asked: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    asked.push(url);
    const r = routes[url];
    if (r === undefined) throw new Error(`unexpected request: ${url}`);
    if (r instanceof Error) throw r;
    const [status, body] = typeof r === "number" ? [r, ""] : r;
    return new Response(body, { status, headers: { "content-type": body.startsWith("<?xml") ? "application/atom+xml" : "text/html" } });
  }) as typeof fetch;
  try {
    return { result: await run(), asked };
  } finally {
    globalThis.fetch = realFetch;
  }
}

test("a channel's name comes from its page", () => {
  assert.equal(extractChannelTitle(channelPage("Jack Conte Extras")), "Jack Conte Extras");
  assert.equal(extractChannelTitle(channelPage('Tom "Q" & Friends')), 'Tom "Q" & Friends');
  assert.equal(extractChannelTitle(`<meta property="og:title" content="Rock &amp; Roll">`), "Rock & Roll");
  assert.equal(extractChannelTitle("<html></html>"), null);
});

test("an @handle whose feed 404s is followed anyway, named from its page, with nothing fetched", async () => {
  const { result, asked } = await withYouTube({ "https://www.youtube.com/@JackConteExtras": [200, channelPage("Jack Conte Extras")], [FEED]: 404 }, () =>
    discover("https://www.youtube.com/@JackConteExtras"),
  );
  assert.equal(result.status, "feed");
  if (result.status !== "feed") return;
  assert.equal(result.waiting, true);
  assert.equal(result.url, FEED);
  assert.equal(result.parsed.title, "Jack Conte Extras");
  assert.equal(result.parsed.items.length, 0);
  assert.deepEqual(asked, ["https://www.youtube.com/@JackConteExtras", FEED], "the page already proved the channel; no third request");
});

test("a feed answering 500, or not at all, is waited for too", async () => {
  for (const answer of [500, 503, new TypeError("fetch failed", { cause: { code: "ECONNRESET" } })]) {
    const { result } = await withYouTube({ "https://www.youtube.com/@JackConteExtras": [200, channelPage("Jack Conte Extras")], [FEED]: answer }, () =>
      discover("https://www.youtube.com/@JackConteExtras"),
    );
    assert.equal(result.status === "feed" && result.waiting, true, String(answer));
  }
});

test("a channel address checks the channel's page before following a feed that isn't answering", async () => {
  const page = `https://www.youtube.com/channel/${ID}`;
  const { result, asked } = await withYouTube({ [FEED]: 404, [page]: [200, channelPage("Jack Conte Extras")] }, () => discover(page));
  assert.equal(result.status === "feed" && result.waiting, true);
  assert.equal(result.status === "feed" && result.parsed.title, "Jack Conte Extras");
  assert.deepEqual(asked, [FEED, page]);
});

test("a channel that doesn't exist still says so", async () => {
  const page = `https://www.youtube.com/channel/${ID}`;
  await assert.rejects(withYouTube({ [FEED]: 404, [page]: 404 }, () => discover(page)), (e: unknown) => e instanceof BadStatus && e.status === 404);
  await assert.rejects(withYouTube({ "https://www.youtube.com/@nobody-at-all": 404 }, () => discover("https://www.youtube.com/@nobody-at-all")), (e: unknown) => e instanceof BadStatus && e.status === 404);
});

test("a working feed is read as before", async () => {
  const { result } = await withYouTube({ "https://www.youtube.com/@JackConteExtras": [200, channelPage("Jack Conte Extras")], [FEED]: [200, atom] }, () =>
    discover("https://www.youtube.com/@JackConteExtras"),
  );
  assert.equal(result.status === "feed" && result.waiting, undefined);
  assert.equal(result.status === "feed" && result.parsed.items.length, 1);
});

test("being asked to slow down is never worked around", async () => {
  // The feed answers 429: no waiting follow, and YouTube is paused for everyone.
  const { result: first } = await withYouTube({ "https://www.youtube.com/@JackConteExtras": [200, channelPage("Jack Conte Extras")], [FEED]: 429 }, () =>
    discover("https://www.youtube.com/@JackConteExtras").then(() => null, (e: unknown) => e),
  );
  assert.ok(first instanceof BadStatus && first.status === 429, String(first));
  // While paused, adding makes no request at all, even for a channel address that needs none to resolve.
  const realFetch = globalThis.fetch;
  let asked = 0;
  globalThis.fetch = (async () => { asked++; return new Response("", { status: 200 }); }) as typeof fetch;
  try {
    await assert.rejects(discover(`https://www.youtube.com/channel/${ID}`), (e: unknown) => e instanceof HostCoolingDown && e.reason === PAUSE_REASONS.slowDown);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(asked, 0);
});
