/**
 * The terms publishers file feeds and posts under, from every place the
 * formats and their common extensions put them, normalized into one plain
 * list. No network, no database.
 * Run with `pnpm --filter @thicket/api test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { categoryTerm, parseFeedDocument } from "./parse.js";

const url = "https://blog.example.com/feed";

const rss = (channel: string, item: string) => parseFeedDocument(`<?xml version="1.0"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:googleplay="http://www.google.com/schemas/play-podcasts/1.0" xmlns:media="http://search.yahoo.com/mrss/">
<channel><title>t</title><link>https://blog.example.com/</link><description>d</description>${channel}
<item><title>x</title><link>https://blog.example.com/1</link>${item}</item></channel></rss>`, url);

test("a term is normalized: plain text, folded, lowercase, hyphens and underscores as spaces", () => {
  for (const raw of ["Artificial-Intelligence", "artificial_intelligence", "  ARTIFICIAL   intelligence ", "#Artificial Intelligence", "<b>Artificial</b> Intelligence", "Artificial Intelligence,"]) {
    assert.equal(categoryTerm(raw), "artificial intelligence", raw);
  }
  assert.equal(categoryTerm("Q&amp;A"), "q&a");
  assert.equal(categoryTerm("ＡＩ"), "ai");
});

test("a term keeps what is part of its name: commas inside it, periods, symbols", () => {
  assert.equal(categoryTerm("Kent, Allegra"), "kent, allegra");
  assert.equal(categoryTerm(".NET"), ".net");
  assert.equal(categoryTerm("Node.js"), "node.js");
  assert.equal(categoryTerm("C++"), "c++");
  assert.equal(categoryTerm("C#"), "c#");
  assert.equal(categoryTerm("Soto, Carlos J (1980- )"), "soto, carlos j (1980- )");
  assert.equal(categoryTerm("COVID-19"), "covid 19");
});

test("nothing left is no term", () => {
  for (const raw of ["", "   ", "#", " , ", "<br/>", null, undefined, 42]) assert.equal(categoryTerm(raw), null, String(raw));
});

test("RSS: <category> on posts and on the channel; the domain is not kept", () => {
  const f = rss(`<category>Technology</category>`, `<category>Rust</category><category domain="http://www.nytimes.com/namespaces/keywords/nyt_geo">Paris (France)</category>`);
  assert.deepEqual(f.categories, ["technology"]);
  assert.deepEqual(f.items[0].categories, ["rust", "paris (france)"]);
});

test("RSS: Dublin Core subjects, iTunes and Google Play categories, keywords", () => {
  const f = rss(
    `<itunes:category text="Science"><itunes:category text="Physics"/></itunes:category><itunes:category text="Education"/><itunes:keywords>quantum, lasers</itunes:keywords><googleplay:category text="Science"/>`,
    `<dc:subject>Optics</dc:subject><itunes:keywords>photons</itunes:keywords>`,
  );
  assert.deepEqual(f.categories, ["science", "physics", "education", "quantum", "lasers"]);
  assert.deepEqual(f.items[0].categories, ["optics", "photons"]);
});

test("repeats that normalize alike are one term, in first-seen order", () => {
  const f = rss("", `<category>AI</category><category>ai</category><category>Rust</category><category> A.I. </category><category>  </category>`);
  assert.deepEqual(f.items[0].categories, ["ai", "rust", "a.i."]);
});

test("a post or feed that names nothing has no categories", () => {
  assert.deepEqual(rss("", "").items[0].categories, []);
  assert.deepEqual(rss("", "").categories, []);
});

test("Atom: the label when there is one, else the term; Blogger's post-kind marker dropped", () => {
  const f = parseFeedDocument(`<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title>t</title><id>x</id><updated>2026-01-01T00:00:00Z</updated>
<category term="photography"/>
<entry><title>x</title><id>1</id><updated>2026-01-01T00:00:00Z</updated>
<category scheme="http://schemas.google.com/g/2005#kind" term="http://schemas.google.com/blogger/2008/kind#post"/>
<category scheme="http://hbr.org/categorization/hbp-subject" term="395110" label="Environmental sustainability"/>
<category term="film-photo"/>
</entry></feed>`, url);
  assert.deepEqual(f.categories, ["photography"]);
  assert.deepEqual(f.items[0].categories, ["environmental sustainability", "film photo"]);
});

test("Media RSS categories and keywords, including inside media:group", () => {
  const f = parseFeedDocument(`<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/"><title>t</title><id>x</id><updated>2026-01-01T00:00:00Z</updated>
<entry><title>x</title><id>1</id><updated>2026-01-01T00:00:00Z</updated>
<media:group><media:category scheme="http://dmoz.org" label="Ski">Sports/Skiing</media:category><media:category>Winter</media:category><media:keywords>snow, alps</media:keywords></media:group>
</entry></feed>`, url);
  assert.deepEqual(f.items[0].categories, ["ski", "winter", "snow", "alps"]);
});

test("JSON Feed: tags on posts; nothing at the feed level", () => {
  const f = parseFeedDocument(`{"version":"https://jsonfeed.org/version/1.1","title":"t","items":[{"id":"1","content_text":"x","tags":["Swift","iOS",""]},{"id":"2","content_text":"y"}]}`, url);
  assert.deepEqual(f.items[0].categories, ["swift", "ios"]);
  assert.deepEqual(f.items[1].categories, []);
  assert.deepEqual(f.categories, []);
});

test("a runaway list is capped, and so is a runaway term", () => {
  const many = Array.from({ length: 300 }, (_, i) => `<category>t${i}</category>`).join("");
  assert.equal(rss("", many).items[0].categories.length, 100);
  assert.equal(rss("", `<category>${"x".repeat(1000)}</category>`).items[0].categories[0].length, 200);
});
