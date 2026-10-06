/**
 * Adding a feed from an article on a site that turns feed readers away from
 * its articles but not its front page (#213). No network, no database: the
 * site is a stub, and hosts are kept in memory.
 * Run with `pnpm --filter @thicket/api test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

// These modules load the database client, which only needs an address to exist; nothing here connects.
process.env.DATABASE_URL ??= "postgres://unused/unused";
const { discover, frontPage } = await import("./discover.js");
const { HostCoolingDown, PAUSE_REASONS, useInMemoryHostsForTests } = await import("./hosts.js");
const { BadStatus } = await import("./http.js");

const ARTICLE = "https://www.example.com/2026/some-article/";
const FRONT = "https://www.example.com/";
const FEED = "https://www.example.com/feed/";
const frontHtml = `<html><head><link rel="alternate" type="application/rss+xml" title="Example" href="/feed/"></head><body></body></html>`;
const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>Example</title><link>https://www.example.com/</link><item><title>a</title><link>https://www.example.com/a</link><guid>a</guid></item></channel></rss>`;

const fakeDns = { lookup: async () => "203.0.113.7", asn: async () => 64500 };

type Answer = number | Error | [number, string, Record<string, string>?, string?];

/** Answer each address from `routes`, and record what was asked. An address not listed fails the test. */
async function withSite<T>(routes: Record<string, Answer>, run: () => Promise<T>): Promise<{ result: T; asked: string[] }> {
  useInMemoryHostsForTests(fakeDns);
  const realFetch = globalThis.fetch;
  const asked: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    asked.push(url);
    const r = routes[url];
    if (r === undefined) throw new Error(`unexpected request: ${url}`);
    if (r instanceof Error) throw r;
    const [status, body, headers] = typeof r === "number" ? [r, "", {}] : [r[0], r[1], r[2] ?? {}];
    const response = new Response(body, { status, headers: { "content-type": body.startsWith("<?xml") ? "application/rss+xml" : "text/html", ...headers } });
    if (typeof r !== "number" && r[3]) Object.defineProperty(response, "url", { value: r[3] });
    return response;
  }) as typeof fetch;
  try {
    return { result: await run(), asked };
  } finally {
    globalThis.fetch = realFetch;
  }
}

const settle = <T>(p: Promise<T>) => p.then(() => null, (e: unknown) => e);

test("the front page is only asked about addresses deeper in the site", () => {
  assert.equal(frontPage(ARTICLE), FRONT);
  assert.equal(frontPage("https://www.example.com/?p=12"), FRONT);
  assert.equal(frontPage(FRONT), null);
  assert.equal(frontPage("https://www.example.com"), null);
});

test("a 401 article also succeeds through an advertised feed", async () => {
  const { result, asked } = await withSite({ [ARTICLE]: 401, [FRONT]: [200, frontHtml], [FEED]: [200, rss] }, () => discover(ARTICLE));
  assert.equal(result.status, "feed");
  assert.deepEqual(asked, [ARTICLE, FRONT, FEED]);
});

test("a query-based article falls back without retaining its query", async () => {
  const article = "https://www.example.com?p=12";
  const { result, asked } = await withSite({ [article]: 403, [FRONT]: [200, frontHtml], [FEED]: [200, rss] }, () => discover(article));
  assert.equal(result.status, "feed");
  assert.deepEqual(asked, [article, FRONT, FEED]);
});

test("multiple advertised feeds return a chooser without fetching or probing", async () => {
  const html = frontHtml.replace("</head>", '<link rel="alternate" type="application/atom+xml" href="https://feeds.example.net/atom"></head>');
  const { result, asked } = await withSite({ [ARTICLE]: 403, [FRONT]: [200, html] }, () => discover(ARTICLE));
  assert.equal(result.status, "candidates");
  assert.equal(result.status === "candidates" && result.candidates.length, 2);
  assert.deepEqual(asked, [ARTICLE, FRONT]);
});

test("a redirected front page resolves relative feed links against its final address", async () => {
  const feed = "https://other.example/blog/feed/";
  const html = frontHtml.replace('href="/feed/"', 'href="feed/"');
  const { result, asked } = await withSite({ [ARTICLE]: 403, [FRONT]: [200, html, {}, "https://other.example/blog/"], [feed]: [200, rss] }, () => discover(ARTICLE));
  assert.equal(result.status === "feed" && result.url, feed);
  assert.deepEqual(asked, [ARTICLE, FRONT, feed]);
});

test("a front page which is itself a feed is accepted", async () => {
  const { result, asked } = await withSite({ [ARTICLE]: 403, [FRONT]: [200, rss] }, () => discover(ARTICLE));
  assert.equal(result.status, "feed");
  assert.deepEqual(asked, [ARTICLE, FRONT]);
});

test("front-page HTTP errors and network errors retain the original block", async () => {
  for (const answer of [404, 500, new TypeError("fetch failed")]) {
    const { result: err, asked } = await withSite({ [ARTICLE]: 401, [FRONT]: answer }, () => settle(discover(ARTICLE)));
    assert.ok(err instanceof BadStatus && err.status === 401);
    assert.deepEqual(asked, [ARTICLE, FRONT]);
  }
});

test("article server errors do not cause front-page requests", async () => {
  for (const status of [500, 503]) {
    const { result: err, asked } = await withSite({ [ARTICLE]: status }, () => settle(discover(ARTICLE)));
    assert.ok(err instanceof BadStatus && err.status === status);
    assert.deepEqual(asked, [ARTICLE]);
  }
});

test("a malformed advertised feed retains the original block without probing", async () => {
  const { result: err, asked } = await withSite({ [ARTICLE]: 403, [FRONT]: [200, frontHtml], [FEED]: [200, "not a feed"] }, () => settle(discover(ARTICLE)));
  assert.ok(err instanceof BadStatus && err.status === 403);
  assert.deepEqual(asked, [ARTICLE, FRONT, FEED]);
});

test("an advertised feed's 429 is reported and its host remains paused", async () => {
  const { result, asked } = await withSite({ [ARTICLE]: 403, [FRONT]: [200, frontHtml], [FEED]: [429, "", { "retry-after": "600" }] }, async () => ({
    err: await settle(discover(ARTICLE)),
    again: await settle(discover(ARTICLE)),
  }));
  assert.ok(result.again instanceof HostCoolingDown);
  assert.deepEqual(asked, [ARTICLE, FRONT, FEED]);
  assert.ok(result.err instanceof BadStatus && result.err.status === 429);
});

test("an advertised feed with an error status is never accepted even if its body parses", async () => {
  for (const status of [401, 403, 404, 500, 429]) {
    const { result: err, asked } = await withSite({ [ARTICLE]: 403, [FRONT]: [200, frontHtml], [FEED]: [status, rss] }, () => settle(discover(ARTICLE)));
    assert.deepEqual(asked, [ARTICLE, FRONT, FEED]);
    assert.ok(err instanceof BadStatus);
    assert.equal(err.status, status === 429 ? 429 : 403);
  }
});

test("a healthy article's advertised feed rate limit also stops discovery", async () => {
  const { result: err, asked } = await withSite({ [ARTICLE]: [200, frontHtml], [FEED]: [429, rss] }, () => settle(discover(ARTICLE)));
  assert.ok(err instanceof BadStatus && err.status === 429);
  assert.deepEqual(asked, [ARTICLE, FEED]);
});

test("a healthy article still probes after an advertised feed returns an error", async () => {
  const probe = "https://www.example.com/feed";
  const { result, asked } = await withSite({ [ARTICLE]: [200, frontHtml], [FEED]: [500, rss.replace("<title>Example", "<title>Error")], [probe]: [200, rss] }, () => discover(ARTICLE));
  assert.equal(result.status === "feed" && result.url, probe);
  assert.deepEqual(asked, [ARTICLE, FEED, probe]);
});

test("a redirected blocked article uses the final site's front page", async () => {
  const finalArticle = "https://canonical.example/2026/article/";
  const finalFront = "https://canonical.example/";
  const feed = "https://canonical.example/feed/";
  const { result, asked } = await withSite({ [ARTICLE]: [403, "", {}, finalArticle], [finalFront]: [200, frontHtml], [feed]: [200, rss] }, () => discover(ARTICLE));
  assert.equal(result.status, "feed");
  assert.deepEqual(asked, [ARTICLE, finalFront, feed]);
});

test("an article redirected to a blocked front page does not fetch it again", async () => {
  const { result: err, asked } = await withSite({ [ARTICLE]: [403, "", {}, "https://canonical.example/"] }, () => settle(discover(ARTICLE)));
  assert.ok(err instanceof BadStatus && err.status === 403);
  assert.deepEqual(asked, [ARTICLE]);
});

test("an article that turns feed readers away is followed through its site's front page", async () => {
  const { result, asked } = await withSite({ [ARTICLE]: 403, [FRONT]: [200, frontHtml], [FEED]: [200, rss] }, () => discover(ARTICLE));
  assert.equal(result.status, "feed");
  assert.equal(result.status === "feed" && result.url, FEED);
  assert.deepEqual(asked, [ARTICLE, FRONT, FEED]);
});

test("a front page that turns us away too reports the original block, with one extra request", async () => {
  const { result: err, asked } = await withSite({ [ARTICLE]: 403, [FRONT]: 403 }, () => settle(discover(ARTICLE)));
  assert.ok(err instanceof BadStatus && err.status === 403);
  assert.deepEqual(asked, [ARTICLE, FRONT]);
});

test("after a block, a front page advertising nothing isn't probed for feeds", async () => {
  const { result: err, asked } = await withSite({ [ARTICLE]: 401, [FRONT]: [200, "<html><head></head></html>"] }, () => settle(discover(ARTICLE)));
  assert.ok(err instanceof BadStatus && err.status === 401);
  assert.deepEqual(asked, [ARTICLE, FRONT], "no /feed, /rss, … probes on a site that just turned us away");
});

test("after a block, an advertised feed that's blocked too ends there", async () => {
  const { result: err, asked } = await withSite({ [ARTICLE]: 403, [FRONT]: [200, frontHtml], [FEED]: 403 }, () => settle(discover(ARTICLE)));
  assert.ok(err instanceof BadStatus && err.status === 403);
  assert.deepEqual(asked, [ARTICLE, FRONT, FEED]);
});

test("a front page that turns us away is not asked about itself again", async () => {
  const { result: err, asked } = await withSite({ [FRONT]: 403 }, () => settle(discover(FRONT)));
  assert.ok(err instanceof BadStatus && err.status === 403);
  assert.deepEqual(asked, [FRONT]);
});

test("an article that isn't there is not looked for elsewhere", async () => {
  const { result: err, asked } = await withSite({ [ARTICLE]: 404 }, () => settle(discover(ARTICLE)));
  assert.ok(err instanceof BadStatus && err.status === 404);
  assert.deepEqual(asked, [ARTICLE]);
});

test("being asked to slow down is never worked around", async () => {
  // On the article itself: no second request at all.
  const first = await withSite({ [ARTICLE]: [429, "", { "retry-after": "600" }] }, () => settle(discover(ARTICLE)));
  assert.ok(first.result instanceof BadStatus && first.result.status === 429);
  assert.deepEqual(first.asked, [ARTICLE]);

  // On the front page: that's what's reported, and the host is paused for everything after.
  const second = await withSite({ [ARTICLE]: 403, [FRONT]: [429, "", { "retry-after": "600" }] }, async () => {
    const err = await settle(discover(ARTICLE));
    const again = await settle(discover(ARTICLE));
    return { err, again };
  });
  assert.ok(second.result.err instanceof BadStatus && second.result.err.status === 429);
  assert.ok(second.result.again instanceof HostCoolingDown && second.result.again.reason === PAUSE_REASONS.slowDown);
  assert.deepEqual(second.asked, [ARTICLE, FRONT], "nothing asked once the host said slow down");
});
