/**
 * Which picture a post's card gets. No network, no database.
 * Run with `pnpm --filter @thicket/api test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { choosePreview, firstImg, repickPreview } from "./images.js";

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

const USER_ICON = `<a href="https://someone.dreamwidth.org/profile"><img src="https://www.dreamwidth.org/img/silk/identity/user.png" alt="[personal profile] " width="17" height="17" style="vertical-align: text-bottom;" /></a>`;

test("a small icon beside a name in the body is not the card's picture", () => {
  assert.equal(choosePreview(null, `<p>${USER_ICON}someone wrote:</p>`, "https://x.dreamwidth.org/1.html"), null);
});

test("the body's first large image is chosen past icons, emoji and avatars", () => {
  const body = `${USER_ICON}<img src="https://s.w.org/images/core/emoji/15.0.3/72x72/1f600.png" width="16" height="16">`
    + `<img src="https://secure.gravatar.com/avatar/abc?s=48"><img src="https://x.org/photo.jpg" width="640" height="480">`;
  assert.equal(firstImg(body), "https://x.org/photo.jpg");
});

test("a width given as a percentage is not a size", () => {
  assert.equal(firstImg(`<img src="https://x.org/a.jpg" width="50%">`), "https://x.org/a.jpg");
});

test("the backfill clears a small icon stored from the body when nothing large is there", () => {
  const icon = "https://www.dreamwidth.org/img/silk/identity/user.png";
  assert.equal(repickPreview(icon, `<p>${USER_ICON}someone wrote:</p>`, "https://x.dreamwidth.org/1.html"), null);
});

test("the backfill swaps a small icon stored from the body for the body's large image", () => {
  const icon = "https://www.dreamwidth.org/img/silk/identity/user.png";
  const body = `<p>${USER_ICON}someone wrote:</p><img src="https://x.org/photo.jpg">`;
  assert.equal(repickPreview(icon, body, "https://x.dreamwidth.org/1.html"), "https://x.org/photo.jpg");
});

test("the backfill keeps a stored picture that isn't from the body", () => {
  assert.equal(repickPreview("https://x.org/hero.jpg", `<p>${USER_ICON}text</p>`, "https://x.org/a"), "https://x.org/hero.jpg");
});
