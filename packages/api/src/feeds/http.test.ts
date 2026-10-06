import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { createServer as createHttpServer } from "node:http";
import { gzipSync } from "node:zlib";

process.env.DATABASE_URL ??= "postgres://unused/unused";
const { httpGet, httpGetBytes, isHttpProtocolError, MAX_BYTES, TooLargeError } = await import("./http.js");
const { useInMemoryHostsForTests } = await import("./hosts.js");
const { checkFeeds } = await import("../lib/importer.js");
const { explainAddFailure } = await import("./explain.js");
const url = "https://archive.example/feed";
const resetHosts = () => useInMemoryHostsForTests({ lookup: async () => { throw new Error("no DNS in tests"); } });

async function withResponse(response: () => Response, run: () => Promise<void>) {
  resetHosts();
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => response()) as typeof fetch;
  try { await run(); } finally { globalThis.fetch = realFetch; }
}

test("full-archive feeds larger than the old cap are accepted in full", async () => {
  const body = "x".repeat(9 * 1024 * 1024);
  await withResponse(() => new Response(body), async () => {
    const res = await httpGet(url);
    assert.equal(res.body, body);
    assert.equal(res.truncated, false);
  });
});

test("the feed budget accepts its boundary and rejects declared overflow before reading", async () => {
  await withResponse(() => new Response("x".repeat(MAX_BYTES)), async () => {
    assert.equal((await httpGet(url)).body.length, MAX_BYTES);
  });
  let cancelled = false;
  await withResponse(() => new Response(new ReadableStream({ cancel() { cancelled = true; } }), {
    headers: { "content-length": String(MAX_BYTES + 1), "content-type": "application/atom+xml" },
  }), async () => {
    await assert.rejects(httpGet(url), (err: unknown) => {
      assert.ok(err instanceof TooLargeError);
      assert.equal(err.bytes, MAX_BYTES + 1);
      assert.equal(err.contentType, "application/atom+xml");
      return true;
    });
    assert.equal(cancelled, true);
  });
});

test("streamed overflow is cancelled even without Content-Length", async () => {
  let cancelled = false;
  await withResponse(() => new Response(new ReadableStream({
    start(c) { c.enqueue(new Uint8Array(MAX_BYTES)); c.enqueue(new Uint8Array(1)); },
    cancel() { cancelled = true; },
  })), async () => {
    await assert.rejects(httpGet(url), TooLargeError);
    assert.equal(cancelled, true);
  });
});

test("page snippets and binary downloads retain the 5 MiB budget", async () => {
  const small = 5 * 1024 * 1024;
  await withResponse(() => new Response("x".repeat(small + 1)), async () => {
    const res = await httpGet(url, {}, { truncate: true });
    assert.equal(res.body.length, small);
    assert.equal(res.truncated, true);
  });
  await withResponse(() => new Response("x".repeat(small + 1)), async () => {
    await assert.rejects(httpGetBytes(url), TooLargeError);
  });
  await withResponse(() => new Response("abcde"), async () => {
    const res = await httpGet(url, {}, { maxBytes: 3, truncate: true });
    assert.equal(res.body, "abc");
    assert.equal(res.truncated, true);
  });
  await withResponse(() => new Response("abcde"), async () => {
    await assert.rejects(httpGetBytes(url, {}, { maxBytes: 3 }), TooLargeError);
  });
});

test("protocol errors are recognized through causes, without misclassifying connection failures", () => {
  const err = new TypeError("fetch failed", { cause: { code: "HPE_UNEXPECTED_CONTENT_LENGTH" } });
  assert.equal(isHttpProtocolError(err), true);
  assert.equal(isHttpProtocolError(new Error("wrapper", { cause: err })), true);
  assert.equal(isHttpProtocolError(new Error("Response does not match the HTTP/1.1 protocol")), true);
  assert.equal(isHttpProtocolError(new TypeError("fetch failed", { cause: { code: "ECONNRESET" } })), false);
  const cycle = { cause: null as unknown }; cycle.cause = cycle;
  assert.equal(isHttpProtocolError(cycle), false);
});

test("conflicting HTTP framing stays rejected and import/add failures explain the response", async () => {
  resetHosts();
  const server = createServer(socket => {
    socket.once("data", () => socket.end(
      "HTTP/1.1 200 OK\r\nContent-Length: 4\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n4\r\ntest\r\n0\r\n\r\n",
    ));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const local = `http://127.0.0.1:${address.port}/feed`;
  try {
    await assert.rejects(httpGet(local), (err: unknown) => {
      assert.equal(isHttpProtocolError(err), true);
      assert.match(explainAddFailure(err, local), /malformed web response/);
      return true;
    });
    resetHosts();
    const [verdict] = await checkFeeds([local]);
    assert.equal(verdict.state, "failed");
    assert.equal(verdict.retry, false);
    assert.match(verdict.reason!, /malformed web response/);
    assert.doesNotMatch(verdict.reason!, /couldn’t reach/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  }
});


test("compressed responses are limited by decoded size rather than Content-Length", async () => {
  resetHosts();
  const compressed = gzipSync(Buffer.alloc(MAX_BYTES + 1, 120));
  assert.ok(compressed.length < MAX_BYTES);
  const server = createHttpServer((_req, res) => {
    res.writeHead(200, { "content-encoding": "gzip", "content-length": compressed.length });
    res.end(compressed);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    await assert.rejects(httpGet(`http://127.0.0.1:${address.port}/feed`), TooLargeError);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  }
});
