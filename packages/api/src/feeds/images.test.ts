/**
 * Which picture a post's card gets. No network, no database.
 * Run with `pnpm --filter @thicket/api test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { choosePreview, firstImg } from "./images.js";

const NPR_PIXEL = "https://media.npr.org/include/images/tracking/npr-rss-pixel.png?story=nx-s1-5896338";

test("NPR's tracking pixel in the body is not the card's picture", () => {
  const body = `<p>Status trackers are everywhere.</p><img src='${NPR_PIXEL}' />`;
  assert.equal(choosePreview(null, body, "https://www.npr.org/a"), null);
});

test("a declared tracking pixel gives way to a real picture in the body", () => {
  const body = `<p>Text</p><img src="https://example.org/photo.jpg">`;
  assert.equal(choosePreview(NPR_PIXEL, body, "https://www.npr.org/a"), "https://example.org/photo.jpg");
});

test("a declared 1×1 picture with nothing in the body gives no picture", () => {
  assert.equal(choosePreview({ url: "https://x.org/t.gif", width: 1, height: 1 }, "<p>Text</p>", "https://x.org/a"), null);
});

test("a declared small thumbnail is still used when the body has nothing better", () => {
  assert.equal(choosePreview({ url: "https://x.org/thumb.jpg", width: 72, height: 72 }, "<p>Text</p>", "https://x.org/a"), "https://x.org/thumb.jpg");
});

test("the body's first real image is chosen past pixels and 1×1 images", () => {
  const body = `<img src="${NPR_PIXEL}"><img src="https://x.org/beacon.gif" width="1" height="1"><img src="https://x.org/real.jpg" width="800">`;
  assert.equal(firstImg(body), "https://x.org/real.jpg");
});

test("an image with no size given still counts", () => {
  assert.equal(firstImg(`<img src="https://x.org/a.jpg">`), "https://x.org/a.jpg");
});
