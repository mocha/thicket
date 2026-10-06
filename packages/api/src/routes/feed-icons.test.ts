import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";

process.env.DATABASE_URL ??= "postgres://not-used-by-tests";
const { feeds } = await import("./feeds.js");
const { db } = await import("../db/client.js");
const { PUBLIC_URL } = await import("../lib/config.js");
const fetchedAt = new Date("2026-01-01T00:00:00Z");
const etag = `"7-${fetchedAt.getTime()}-png-v2"`;

async function icon(width: number, height: number, format: "png" | "jpeg" | "gif" | "webp" = "png") {
  return sharp({ create: { width, height, channels: 4, background: "red" } }).toFormat(format).toBuffer();
}

test("preview icons remain square across dimensions and supported formats", async (t) => {
  for (const [width, height, format] of [
    [180, 30, "png"], [180, 2000, "png"], [144, 144, "png"],
    [1200, 675, "webp"], [300, 300, "jpeg"], [180, 180, "gif"],
  ] as const) {
    const bytes = await icon(width, height, format);
    const mocked = t.mock.method(db, "select", () => ({ from: () => ({ where: async () => [{ bytes, fetchedAt, contentType: `image/${format}` }] }) }));
    const response = await feeds.request("/7/icon.png");
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/png");
    assert.equal(response.headers.get("etag"), etag);
    const output = Buffer.from(await response.arrayBuffer());
    const metadata = await sharp(output).metadata();
    assert.equal(metadata.width, 512);
    assert.equal(metadata.height, 512);
    if (width === 180 && height === 30) {
      const { data, info } = await sharp(output).raw().toBuffer({ resolveWithObject: true });
      let opaque = 0;
      for (let i = 3; i < data.length; i += info.channels) if (data[i] === 255) opaque++;
      assert.equal(opaque, width * height, "small icons are padded without enlarging or cropping");
    }
    const cached = await feeds.request("/7/icon.png", { headers: { "if-none-match": etag } });
    assert.equal(cached.status, 304);
    assert.equal(cached.headers.get("etag"), etag);
    assert.ok(cached.headers.get("cache-control")?.includes("max-age=86400"));
    const old = await feeds.request("/7/icon.png", { headers: { "if-none-match": `"7-${fetchedAt.getTime()}-png"` } });
    assert.equal(old.status, 200, "old non-square representation is invalidated");
    mocked.mock.restore();
  }
});

test("missing, corrupt, truncated and over-limit preview icons fall back even with a conditional request", async (t) => {
  const truncated = (await icon(180, 180)).subarray(0, 64);
  const oversized = await icon(5001, 5001);
  assert.ok(oversized.length < 512 * 1024, "fetcher's byte limit alone cannot protect decoding");
  for (const bytes of [undefined, Buffer.from("broken image"), truncated, oversized]) {
    const mocked = t.mock.method(db, "select", () => ({ from: () => ({ where: async () => bytes ? [{ bytes, fetchedAt, contentType: "image/png" }] : [] }) }));
    for (const headers of [new Headers(), new Headers({ "if-none-match": etag })]) {
      const response = await feeds.request("/7/icon.png", { headers });
      assert.equal(response.status, 302);
      assert.equal(response.headers.get("location"), `${PUBLIC_URL}/og-image.png`);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(response.headers.get("etag"), null);
    }
    const raw = await feeds.request("/7/icon");
    assert.equal(raw.status, bytes ? 200 : 404);
    if (bytes) {
      assert.deepEqual(Buffer.from(await raw.arrayBuffer()), bytes);
      assert.equal(raw.headers.get("etag"), `"7-${fetchedAt.getTime()}"`);
    }
    mocked.mock.restore();
  }
});
