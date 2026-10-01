/**
 * The bookmark export file: its shape, the sentence that describes each
 * bookmark, and that nothing typed by a person or sent by a feed can break
 * out of it. Run with `pnpm --filter @thicket/api test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EXPORT_MAX, describeBookmark, escapeHtml, exportAddress, exportTimeZone, exportTitle, renderBookmarkFile, type ExportRow } from "./bookmark-export.js";

const BASE = "https://thicket.example";
const saved = new Date("2026-10-13T16:32:00Z");
const posted = new Date("2026-10-12T14:33:00Z");
const render = (rows: ExportRow[], timeZone: string | null = "America/Chicago", handle = "fern") => renderBookmarkFile(rows, { handle, timeZone, base: BASE });
const bare = (over: Partial<ExportRow> = {}): ExportRow => ({ url: "https://example.com/a", title: "A", note: null, savedAt: saved, ...over });
const full = (over: Partial<ExportRow> = {}): ExportRow => bare({ author: "Ford James", siteTitle: "Polygon.com", publishedAt: posted, ...over });

// ---- the file ----

test("an empty account still gets a whole file, named for whose it is and where from", () => {
  const file = render([]);
  assert.ok(file.startsWith("<!DOCTYPE NETSCAPE-Bookmark-file-1>\n"));
  assert.match(file, /<META HTTP-EQUIV="Content-Type" CONTENT="text\/html; charset=UTF-8">/);
  assert.ok(file.endsWith("<TITLE>@fern&#39;s bookmarks from thicket.example</TITLE>\n<H1>@fern&#39;s bookmarks from thicket.example</H1>\n<DL><p>\n</DL><p>\n"));
});

test("the title is the handle and this instance's host, port and all, and escaped", () => {
  assert.equal(exportTitle("fern", "https://readthicket.com"), "@fern's bookmarks from readthicket.com");
  assert.equal(exportTitle("fern", "http://dynamo.lan:5173"), "@fern's bookmarks from dynamo.lan:5173");
  const file = renderBookmarkFile([], { handle: `</TITLE><script>alert(1)</script>`, base: BASE });
  assert.ok(!file.includes("<script>"));
  assert.equal(file.match(/<\/TITLE>/g)?.length, 1);
});

test("a bookmark is one entry with its address, saved time and title, then its description", () => {
  const file = render([full({ title: "A post" })]);
  assert.ok(file.includes(`    <DT><A HREF="https://example.com/a" ADD_DATE="${saved.getTime() / 1000}">A post</A>\n    <DD>Posted on October 12th, 2026 at 9:33am by Ford James for Polygon.com. Bookmarked on October 13th at 11:32am.\n</DL><p>`));
});

test("the saved time reads the same from a Date or the text the database gives", () => {
  assert.equal(render([bare()]), render([bare({ savedAt: "2026-10-13 16:32:00+00" })]));
  assert.match(render([bare()]), /ADD_DATE="1791909120"/);
});

test("a note follows the sentence after a blank line, led in by Note:, line breaks kept", () => {
  const file = render([full({ note: "First thought.\n\nSecond thought." })]);
  assert.ok(file.includes("<DD>Posted on October 12th, 2026 at 9:33am by Ford James for Polygon.com. Bookmarked on October 13th at 11:32am.\n\nNote: First thought.\n\nSecond thought.\n</DL><p>"));
});

test("an empty note adds nothing", () => {
  assert.ok(!render([bare({ note: "  \n " })]).includes("Note:"));
});

// ---- the sentence ----

const say = (row: ExportRow, tz = "America/Chicago") => describeBookmark(row, tz);

test("sentence: everything known", () => {
  assert.equal(say(full()), "Posted on October 12th, 2026 at 9:33am by Ford James for Polygon.com. Bookmarked on October 13th at 11:32am.");
});

test("sentence: no author leaves out by", () => {
  assert.equal(say(full({ author: null })), "Posted on October 12th, 2026 at 9:33am for Polygon.com. Bookmarked on October 13th at 11:32am.");
  assert.equal(say(full({ author: "   " })), say(full({ author: null })));
});

test("sentence: no site leaves out for", () => {
  assert.equal(say(full({ siteTitle: null })), "Posted on October 12th, 2026 at 9:33am by Ford James. Bookmarked on October 13th at 11:32am.");
});

test("sentence: neither author nor site", () => {
  assert.equal(say(full({ author: null, siteTitle: null })), "Posted on October 12th, 2026 at 9:33am. Bookmarked on October 13th at 11:32am.");
});

test("sentence: a bare address has only the bookmarked half, with its year", () => {
  assert.equal(say(bare()), "Bookmarked on October 13th, 2026 at 11:32am.");
});

test("sentence: no published date but an author or site still says so, and the bookmarked date keeps its year", () => {
  assert.equal(say(bare({ author: "Ford James", siteTitle: "Polygon.com" })), "Posted by Ford James for Polygon.com. Bookmarked on October 13th, 2026 at 11:32am.");
  assert.equal(say(bare({ siteTitle: "Polygon.com" })), "Posted for Polygon.com. Bookmarked on October 13th, 2026 at 11:32am.");
});

test("sentence: bookmarked in a different year than posted carries its year", () => {
  assert.equal(say(full({ publishedAt: new Date("2024-03-01T18:05:00Z") })), "Posted on March 1st, 2024 at 12:05pm by Ford James for Polygon.com. Bookmarked on October 13th, 2026 at 11:32am.");
});

test("sentence: the year is judged in the reader's timezone, not in UTC", () => {
  // 03:00 UTC on January 1st is still December 31st in Chicago.
  const row = full({ publishedAt: new Date("2026-12-31T20:00:00Z"), savedAt: new Date("2027-01-01T03:00:00Z") });
  assert.equal(say(row), "Posted on December 31st, 2026 at 2:00pm by Ford James for Polygon.com. Bookmarked on December 31st at 9:00pm.");
  assert.equal(say(row, "UTC"), "Posted on December 31st, 2026 at 8:00pm UTC by Ford James for Polygon.com. Bookmarked on January 1st, 2027 at 3:00am UTC.");
});

test("sentence: UTC says UTC after each time", () => {
  assert.equal(say(full(), "UTC"), "Posted on October 12th, 2026 at 2:33pm UTC by Ford James for Polygon.com. Bookmarked on October 13th at 4:32pm UTC.");
});

test("sentence: ordinals, noon and midnight", () => {
  const day = (iso: string) => say(bare({ savedAt: new Date(iso) }), "UTC");
  assert.equal(day("2026-01-01T00:05:00Z"), "Bookmarked on January 1st, 2026 at 12:05am UTC.");
  assert.equal(day("2026-01-02T12:00:00Z"), "Bookmarked on January 2nd, 2026 at 12:00pm UTC.");
  assert.equal(day("2026-01-03T01:00:00Z"), "Bookmarked on January 3rd, 2026 at 1:00am UTC.");
  for (const [d, s] of [[4, "4th"], [11, "11th"], [12, "12th"], [13, "13th"], [21, "21st"], [22, "22nd"], [23, "23rd"], [30, "30th"], [31, "31st"]] as const) {
    assert.ok(day(`2026-01-${String(d).padStart(2, "0")}T01:00:00Z`).includes(`January ${s},`), s);
  }
});

test("sentence: a site name ending in a full stop does not get a second one, and names are one line", () => {
  assert.equal(say(bare({ siteTitle: "Example Inc." })), "Posted for Example Inc. Bookmarked on October 13th, 2026 at 11:32am.");
  assert.equal(say(bare({ author: " Ford\n  James ", siteTitle: "Poly\tgon" })), "Posted by Ford James for Poly gon. Bookmarked on October 13th, 2026 at 11:32am.");
});

test("sentence: a published date that is not a date is treated as missing", () => {
  assert.equal(say(bare({ publishedAt: "not a date" })), "Bookmarked on October 13th, 2026 at 11:32am.");
});

test("timezone: a real one is used, anything else is UTC", () => {
  assert.equal(exportTimeZone("America/Chicago"), "America/Chicago");
  assert.equal(exportTimeZone("Asia/Kolkata"), "Asia/Kolkata");
  for (const bad of [null, undefined, "", "Mars/Olympus_Mons", "America/Chicago; drop table", "<script>", "x".repeat(200)]) assert.equal(exportTimeZone(bad), "UTC");
  assert.ok(render([full()], "Mars/Olympus_Mons").includes("at 2:33pm UTC"));
  assert.ok(render([full()], null).includes("at 4:32pm UTC"));
  assert.ok(render([full()], "Asia/Kolkata").includes("Posted on October 12th, 2026 at 8:03pm by"));
});

// ---- nothing breaks out ----

test("markup in a title, an author, a site or a note arrives as text", () => {
  const file = render([full({
    title: `<script>alert("t")</script> & 'more'`,
    author: `<img src=x onerror=alert(3)>`,
    siteTitle: `"><script>alert(4)</script>`,
    note: `</DL><DT><A HREF="javascript:alert(1)">click</A><img src=x onerror=alert(2)>`,
  })]);
  assert.ok(!/<script/i.test(file));
  assert.ok(!/<img/i.test(file));
  assert.equal(file.match(/<A /g)?.length, 1);
  assert.equal(file.match(/<\/DL>/g)?.length, 1);
  assert.ok(file.includes("&lt;script&gt;alert(&quot;t&quot;)&lt;/script&gt; &amp; &#39;more&#39;</A>"));
  assert.ok(file.includes("by &lt;img src=x onerror=alert(3)&gt; for &quot;&gt;&lt;script&gt;alert(4)&lt;/script&gt;. Bookmarked"));
  assert.ok(file.includes("Note: &lt;/DL&gt;&lt;DT&gt;&lt;A HREF=&quot;javascript:alert(1)&quot;&gt;"));
});

test("an address cannot close its own attribute", () => {
  const file = render([bare({ url: `https://example.com/?q="><script>alert(1)</script>&x='y'` })]);
  assert.ok(file.includes(`HREF="https://example.com/?q=&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;&amp;x=&#39;y&#39;" ADD_DATE=`));
  assert.ok(!file.includes("<script>"));
});

test("an address that is not a web address is left out", () => {
  const file = render([
    bare({ url: "javascript:alert(1)", title: "Bad", note: "n" }),
    bare({ url: "data:text/html,<script>alert(1)</script>", title: "Worse" }),
    bare({ url: "https://example.com/ok", title: "Good" }),
  ]);
  assert.equal(file.match(/<DT>/g)?.length, 1);
  assert.equal(file.match(/<DD>/g)?.length, 1);
  assert.ok(!file.includes("javascript:"));
  assert.ok(!file.includes("data:"));
  assert.equal(exportAddress("javascript:alert(1)", BASE), null);
  assert.equal(exportAddress("//evil.example/x", BASE), null);
});

test("a post saved under its page here gets this instance's address", () => {
  assert.equal(exportAddress("/feeds/12/some-site/345", BASE), "https://thicket.example/feeds/12/some-site/345");
  assert.ok(render([bare({ url: "/feeds/12/some-site/345" })]).includes(`HREF="https://thicket.example/feeds/12/some-site/345"`));
});

test("a bookmark with no title is named by its address, and a title is one line", () => {
  const file = render([bare({ url: "https://example.com/untitled", title: null }), bare({ url: "https://example.com/b", title: "  Two\nlines\t here " })]);
  assert.ok(file.includes(">https://example.com/untitled</A>"));
  assert.ok(file.includes(">Two lines here</A>"));
});

test("control characters are dropped, other languages and emoji are kept", () => {
  assert.equal(escapeHtml("a\u0000b\u0007c\u001Fd\te\nf"), "abcd\te\nf");
  const file = render([bare({ title: "日本語のタイトル 🌿", note: "Zażółć gęślą jaźń", author: "Zoë Müller" })]);
  assert.ok(file.includes(">日本語のタイトル 🌿</A>"));
  assert.ok(file.includes("Posted by Zoë Müller."));
  assert.ok(file.includes("Note: Zażółć gęślą jaźń"));
});

test("rows are written in the order given, every one of them", () => {
  const file = render([bare({ url: "https://example.com/new", title: "New" }), bare({ url: "https://example.com/old", title: "Old", savedAt: new Date("2020-01-01T00:00:00Z") })]);
  assert.ok(file.indexOf(">New</A>") < file.indexOf(">Old</A>"));
  assert.equal(EXPORT_MAX, 10_000);
  const many = render(Array.from({ length: EXPORT_MAX }, (_, i) => bare({ url: `https://example.com/${i}` })));
  assert.equal(many.match(/<DT>/g)?.length, EXPORT_MAX);
});
