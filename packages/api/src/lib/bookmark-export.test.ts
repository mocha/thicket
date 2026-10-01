/**
 * The bookmark export file: its shape, the paragraphs that describe each
 * bookmark, and that nothing typed by a person or sent by a feed can break
 * out of it. Run with `pnpm --filter @thicket/api test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EXPORT_MAX, bylineHtml, describeBookmark, escapeHtml, exportAddress, exportTime, exportTimeZone, exportTitle, renderBookmarkFile, type ExportRow } from "./bookmark-export.js";

const BASE = "https://thicket.example";
const saved = new Date("2026-10-13T16:32:00Z");
const posted = new Date("2026-10-12T14:33:00Z");
const render = (rows: ExportRow[], timeZone: string | null = "America/Chicago", handle = "fern") => renderBookmarkFile(rows, { handle, timeZone, base: BASE });
const bare = (over: Partial<ExportRow> = {}): ExportRow => ({ url: "https://example.com/a", title: "A", note: null, savedAt: saved, ...over });
const full = (over: Partial<ExportRow> = {}): ExportRow => bare({ author: "Ford James", siteTitle: "Polygon.com", publishedAt: posted, ...over });

const POSTED = `<time datetime="2026-10-12T09:33-05:00">October 12th, 2026 at 9:33am</time>`;
const SAVED = `<p class="saved">Bookmarked <time datetime="2026-10-13T11:32-05:00">October 13th, 2026 at 11:32am</time></p>`;

// ---- the file ----

test("an empty account still gets a whole file, named for whose it is and where from", () => {
  const file = render([]);
  assert.ok(file.startsWith("<!DOCTYPE NETSCAPE-Bookmark-file-1>\n"));
  assert.match(file, /<META HTTP-EQUIV="Content-Type" CONTENT="text\/html; charset=UTF-8">\n<META NAME="viewport" CONTENT="width=device-width, initial-scale=1">\n<TITLE>@fern&#39;s bookmarks from thicket.example<\/TITLE>\n<STYLE>/);
  assert.ok(file.endsWith("</STYLE>\n<H1>@fern&#39;s bookmarks from thicket.example</H1>\n<DL><p>\n</DL><p>\n"));
});

test("the stylesheet is the file's own: dark mode, no network, no script", () => {
  const file = render([]);
  const style = file.slice(file.indexOf("<STYLE>"), file.indexOf("</STYLE>"));
  assert.match(style, /prefers-color-scheme: dark/);
  assert.ok(!/url\(|@import|https?:/i.test(style));
  assert.ok(!/<script|<link|<img|<h3/i.test(file));
  assert.equal(file.match(/<STYLE>/g)?.length, 1);
});

test("the title is the handle and this instance's host, port and all, and escaped", () => {
  assert.equal(exportTitle("fern", "https://readthicket.com"), "@fern's bookmarks from readthicket.com");
  assert.equal(exportTitle("fern", "http://dynamo.lan:5173"), "@fern's bookmarks from dynamo.lan:5173");
  const file = renderBookmarkFile([], { handle: `</TITLE><script>alert(1)</script>`, base: BASE });
  assert.ok(!file.includes("<script>"));
  assert.equal(file.match(/<\/TITLE>/g)?.length, 1);
});

test("a bookmark is its link line exactly, then its description paragraphs", () => {
  const file = render([full({ title: "A post", note: "A thought." })]);
  assert.ok(file.includes([
    `    <DT><A HREF="https://example.com/a" ADD_DATE="${saved.getTime() / 1000}">A post</A>`,
    `    <DD>`,
    `      <p class="byline">By Ford James for Polygon.com, posted ${POSTED}</p>`,
    `      <p class="note"><em>My note:</em> A thought.</p>`,
    `      ${SAVED}`,
    `</DL><p>`,
  ].join("\n")));
});

test("the saved time reads the same from a Date or the text the database gives", () => {
  assert.equal(render([bare()]), render([bare({ savedAt: "2026-10-13 16:32:00+00" })]));
  assert.match(render([bare()]), /ADD_DATE="1791909120"/);
});

test("no entry uses a heading, which would mean a folder", () => {
  assert.ok(!/<h[1-6]/i.test(render([full({ note: "# A heading in Markdown" })]).split("<DL><p>")[1]));
});

// ---- the paragraphs ----

const say = (row: ExportRow, tz = "America/Chicago") => describeBookmark(row, tz);
const by = (row: ExportRow, tz = "America/Chicago") => bylineHtml(row, tz);

test("byline: author, site and date", () => {
  assert.equal(by(full()), `By Ford James for Polygon.com, posted ${POSTED}`);
});

test("byline: author and site, no date", () => {
  assert.equal(by(full({ publishedAt: null })), "By Ford James for Polygon.com");
});

test("byline: author and date, no site", () => {
  assert.equal(by(full({ siteTitle: null })), `By Ford James, posted ${POSTED}`);
});

test("byline: site and date, no author", () => {
  assert.equal(by(full({ author: null })), `From Polygon.com, posted ${POSTED}`);
  assert.equal(by(full({ author: "   " })), by(full({ author: null })));
});

test("byline: author alone, site alone, date alone", () => {
  assert.equal(by(bare({ author: "Ford James" })), "By Ford James");
  assert.equal(by(bare({ siteTitle: "Polygon.com" })), "From Polygon.com");
  assert.equal(by(bare({ publishedAt: posted })), `Posted ${POSTED}`);
});

test("byline: none of the three is no byline, and a date that is not a date is no date", () => {
  assert.equal(by(bare()), null);
  assert.equal(by(bare({ publishedAt: "not a date" })), null);
  assert.equal(by(bare({ author: "Ford James", publishedAt: "not a date" })), "By Ford James");
});

test("byline: names are one line", () => {
  assert.equal(by(bare({ author: " Ford\n  James ", siteTitle: "Poly\tgon" })), "By Ford James for Poly gon");
});

test("description: a bare address has only the bookmarked paragraph", () => {
  assert.deepEqual(say(bare()), [SAVED]);
});

test("description: byline, note, bookmarked, in that order, the note only when there is one", () => {
  assert.deepEqual(say(full()), [`<p class="byline">By Ford James for Polygon.com, posted ${POSTED}</p>`, SAVED]);
  assert.deepEqual(say(bare({ note: "Only a note." })), [`<p class="note"><em>My note:</em> Only a note.</p>`, SAVED]);
  assert.deepEqual(say(bare({ note: "  \n " })), [SAVED]);
  assert.equal(say(full({ note: "x" })).length, 3);
});

test("description: the bookmarked date always carries its year", () => {
  assert.ok(say(full())[1].includes("October 13th, 2026 at 11:32am"));
  assert.ok(say(full({ publishedAt: new Date("2024-03-01T18:05:00Z") }))[1].includes("October 13th, 2026 at 11:32am"));
});

test("note: Markdown is kept as typed, not rendered, with its line breaks", () => {
  const note = "First *thought*.\n\n- one\n- two\n\n[a link](https://example.com) and `code`";
  assert.equal(say(bare({ note }))[0], `<p class="note"><em>My note:</em> ${note}</p>`);
  const file = render([bare({ note: "# Heading\n> quote & <b>" })]);
  assert.ok(file.includes(`<em>My note:</em> # Heading\n&gt; quote &amp; &lt;b&gt;</p>`));
});

// ---- times ----

test("time: readable words and an ISO time with the zone's distance from UTC", () => {
  assert.deepEqual(exportTime(posted, "America/Chicago"), { text: "October 12th, 2026 at 9:33am", iso: "2026-10-12T09:33-05:00" });
  assert.deepEqual(exportTime(posted, "Asia/Kolkata"), { text: "October 12th, 2026 at 8:03pm", iso: "2026-10-12T20:03+05:30" });
  assert.deepEqual(exportTime(posted, "Europe/London"), { text: "October 12th, 2026 at 3:33pm", iso: "2026-10-12T15:33+01:00" });
  assert.deepEqual(exportTime(new Date("2026-01-15T12:00:00Z"), "Europe/London"), { text: "January 15th, 2026 at 12:00pm", iso: "2026-01-15T12:00+00:00" });
  assert.deepEqual(exportTime(new Date("2026-01-15T12:00:00Z"), "America/Chicago"), { text: "January 15th, 2026 at 6:00am", iso: "2026-01-15T06:00-06:00" });
});

test("time: the ISO time names the same moment it was given", () => {
  for (const tz of ["America/Chicago", "Asia/Kolkata", "Pacific/Chatham", "Australia/Lord_Howe", "America/St_Johns", "UTC"]) {
    for (const d of [posted, saved, new Date("2026-03-08T08:30:00Z"), new Date("2026-12-31T23:59:00Z")]) {
      assert.equal(new Date(exportTime(d, tz).iso).getTime(), d.getTime(), `${tz} ${d.toISOString()}`);
    }
  }
});

test("time: UTC says UTC to people and Z to machines", () => {
  assert.deepEqual(exportTime(posted, "UTC"), { text: "October 12th, 2026 at 2:33pm UTC", iso: "2026-10-12T14:33Z" });
  assert.deepEqual(say(full(), "UTC"), [
    `<p class="byline">By Ford James for Polygon.com, posted <time datetime="2026-10-12T14:33Z">October 12th, 2026 at 2:33pm UTC</time></p>`,
    `<p class="saved">Bookmarked <time datetime="2026-10-13T16:32Z">October 13th, 2026 at 4:32pm UTC</time></p>`,
  ]);
});

test("time: the day and year are the reader's, not UTC's", () => {
  // 03:00 UTC on January 1st is still December 31st in Chicago.
  assert.deepEqual(exportTime(new Date("2027-01-01T03:00:00Z"), "America/Chicago"), { text: "December 31st, 2026 at 9:00pm", iso: "2026-12-31T21:00-06:00" });
});

test("time: ordinals, noon and midnight", () => {
  const day = (iso: string) => exportTime(new Date(iso), "UTC");
  assert.deepEqual(day("2026-01-01T00:05:00Z"), { text: "January 1st, 2026 at 12:05am UTC", iso: "2026-01-01T00:05Z" });
  assert.equal(day("2026-01-02T12:00:00Z").text, "January 2nd, 2026 at 12:00pm UTC");
  assert.equal(day("2026-01-03T01:00:00Z").text, "January 3rd, 2026 at 1:00am UTC");
  for (const [d, s] of [[4, "4th"], [11, "11th"], [12, "12th"], [13, "13th"], [21, "21st"], [22, "22nd"], [23, "23rd"], [30, "30th"], [31, "31st"]] as const) {
    assert.ok(day(`2026-01-${String(d).padStart(2, "0")}T01:00:00Z`).text.includes(`January ${s},`), s);
  }
});

test("timezone: a real one is used, anything else is UTC", () => {
  assert.equal(exportTimeZone("America/Chicago"), "America/Chicago");
  assert.equal(exportTimeZone("Asia/Kolkata"), "Asia/Kolkata");
  for (const bad of [null, undefined, "", "Mars/Olympus_Mons", "America/Chicago; drop table", "<script>", "x".repeat(200)]) assert.equal(exportTimeZone(bad), "UTC");
  assert.ok(render([full()], "Mars/Olympus_Mons").includes("at 2:33pm UTC</time>"));
  assert.ok(render([full()], null).includes("at 4:32pm UTC</time>"));
  assert.ok(render([full()], "Asia/Kolkata").includes(`posted <time datetime="2026-10-12T20:03+05:30">October 12th, 2026 at 8:03pm</time>`));
});

// ---- nothing breaks out ----

/** Every tag in the file after the head, by name. Only these are ever ours to write. */
const tagsIn = (file: string) => [...file.slice(file.indexOf("<H1>")).matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)/g)].map((m) => m[1].toLowerCase());

test("markup in a title, an author, a site or a note arrives as text", () => {
  const file = render([full({
    title: `<script>alert("t")</script> & 'more'`,
    author: `<img src=x onerror=alert(3)>`,
    siteTitle: `"></p><script>alert(4)</script>`,
    note: `</p></DL><DT><A HREF="javascript:alert(1)">click</A><img src=x onerror=alert(2)><time datetime="x">`,
  })]);
  assert.ok(!/<script/i.test(file));
  assert.ok(!/<img/i.test(file));
  assert.deepEqual(tagsIn(file), ["h1", "h1", "dl", "p", "dt", "a", "a", "dd", "p", "time", "time", "p", "p", "em", "em", "p", "p", "time", "time", "p", "dl", "p"]);
  assert.ok(file.includes("&lt;script&gt;alert(&quot;t&quot;)&lt;/script&gt; &amp; &#39;more&#39;</A>"));
  assert.ok(file.includes(`<p class="byline">By &lt;img src=x onerror=alert(3)&gt; for &quot;&gt;&lt;/p&gt;&lt;script&gt;alert(4)&lt;/script&gt;, posted <time`));
  assert.ok(file.includes(`<em>My note:</em> &lt;/p&gt;&lt;/DL&gt;&lt;DT&gt;&lt;A HREF=&quot;javascript:alert(1)&quot;&gt;click&lt;/A&gt;&lt;img src=x onerror=alert(2)&gt;&lt;time datetime=&quot;x&quot;&gt;</p>`));
});

test("an address cannot close its own attribute", () => {
  const file = render([bare({ url: `https://example.com/?q="><script>alert(1)</script>&x='y'` })]);
  assert.ok(file.includes(`HREF="https://example.com/?q=&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;&amp;x=&#39;y&#39;" ADD_DATE=`));
  assert.ok(!file.includes("<script>"));
});

test("an address that is not a web address is left out, description and all", () => {
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
  assert.ok(file.includes(`<p class="byline">By Zoë Müller</p>`));
  assert.ok(file.includes("<em>My note:</em> Zażółć gęślą jaźń</p>"));
});

test("rows are written in the order given, every one of them", () => {
  const file = render([bare({ url: "https://example.com/new", title: "New" }), bare({ url: "https://example.com/old", title: "Old", savedAt: new Date("2020-01-01T00:00:00Z") })]);
  assert.ok(file.indexOf(">New</A>") < file.indexOf(">Old</A>"));
  assert.equal(EXPORT_MAX, 10_000);
  const many = render(Array.from({ length: EXPORT_MAX }, (_, i) => bare({ url: `https://example.com/${i}` })));
  assert.equal(many.match(/<DT>/g)?.length, EXPORT_MAX);
});
