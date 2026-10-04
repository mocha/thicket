/**
 * What language a feed says it is in. No network, no database.
 * Run with `pnpm --filter @thicket/api test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { feedLanguage, parseFeedDocument } from "./parse.js";

const url = "https://blog.example.com/feed";

test("a declared language comes down to its bare code", () => {
  for (const tag of ["en", "en-US", "en-us", "en_GB", "EN", " en-gb ", "en-en", "eng", "ENG", "eng-US"]) assert.equal(feedLanguage(tag), "en", tag);
  assert.equal(feedLanguage("de-DE"), "de");
  assert.equal(feedLanguage("ger"), "de");
  assert.equal(feedLanguage("zh-Hant-TW"), "zh");
});

test("a declaration that isn't a language tag counts as none", () => {
  for (const tag of ["English", "", "un", "und", "x-default", "en us", undefined, null, 42]) assert.equal(feedLanguage(tag), null, String(tag));
});

test("RSS: <language>, then <dc:language>", () => {
  const rss = (head: string) => parseFeedDocument(`<?xml version="1.0"?><rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>t</title><link>https://blog.example.com/</link><description>d</description>${head}<item><title>x</title><link>https://blog.example.com/1</link></item></channel></rss>`, url);
  assert.equal(rss("<language>en-US</language>").language, "en");
  assert.equal(rss("<dc:language>de</dc:language>").language, "de");
  assert.equal(rss("").language, null);
});

test("Atom: xml:lang on the feed, or else on its entries", () => {
  const atom = (feedAttr: string, entryAttr = "") => parseFeedDocument(`<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"${feedAttr}><title>t</title><id>x</id><updated>2026-01-01T00:00:00Z</updated><entry${entryAttr}><title>x</title><id>1</id><updated>2026-01-01T00:00:00Z</updated></entry></feed>`, url);
  assert.equal(atom(` xml:lang="fr-CA"`).language, "fr");
  assert.equal(atom("", ` xml:lang="de"`).language, "de");
  assert.equal(atom(` xml:lang="en-GB"`, ` xml:lang="de"`).language, "en");
  assert.equal(atom("").language, null);
});

test("JSON Feed: language", () => {
  const json = (extra: string) => parseFeedDocument(`{"version":"https://jsonfeed.org/version/1.1","title":"t"${extra},"items":[{"id":"1","content_text":"x"}]}`, url);
  assert.equal(json(`,"language":"en-GB"`).language, "en");
  assert.equal(json("").language, null);
});
