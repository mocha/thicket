/**
 * The bookmark export file: its shape, and that nothing typed by a person or
 * sent by a feed can break out of it. Run with `pnpm --filter @thicket/api test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { escapeHtml, exportAddress, renderBookmarkFile } from "./bookmark-export.js";

const BASE = "https://thicket.example";
const saved = new Date("2026-09-30T12:00:00Z");
const render = (rows: Parameters<typeof renderBookmarkFile>[0]) => renderBookmarkFile(rows, BASE);

test("an empty account still gets a whole file", () => {
  const file = render([]);
  assert.ok(file.startsWith("<!DOCTYPE NETSCAPE-Bookmark-file-1>\n"));
  assert.match(file, /<META HTTP-EQUIV="Content-Type" CONTENT="text\/html; charset=UTF-8">/);
  assert.match(file, /<TITLE>Bookmarks<\/TITLE>\n<H1>Bookmarks<\/H1>\n<DL><p>\n<\/DL><p>\n$/);
});

test("a bookmark is one entry with its address, saved date and title", () => {
  const file = render([{ url: "https://example.com/a", title: "A post", note: null, savedAt: saved }]);
  assert.ok(file.includes(`    <DT><A HREF="https://example.com/a" ADD_DATE="${saved.getTime() / 1000}">A post</A>\n`));
  assert.ok(!file.includes("<DD>"));
});

test("the saved date reads the same from a Date or the text the database gives", () => {
  const a = render([{ url: "https://example.com/a", title: "A", note: null, savedAt: saved }]);
  const b = render([{ url: "https://example.com/a", title: "A", note: null, savedAt: "2026-09-30 12:00:00+00" }]);
  assert.equal(a, b);
  assert.match(a, /ADD_DATE="1790769600"/);
});

test("a note is the entry's description, line breaks kept", () => {
  const file = render([{ url: "https://example.com/a", title: "A", note: "First thought.\n\nSecond thought.", savedAt: saved }]);
  assert.ok(file.includes("</A>\n    <DD>First thought.\n\nSecond thought.\n</DL><p>"));
});

test("an empty note writes no description", () => {
  assert.ok(!render([{ url: "https://example.com/a", title: "A", note: "  \n ", savedAt: saved }]).includes("<DD>"));
});

test("markup in a title or a note arrives as text", () => {
  const file = render([{
    url: "https://example.com/a",
    title: `<script>alert("t")</script> & 'more'`,
    note: `</DL><DT><A HREF="javascript:alert(1)">click</A><img src=x onerror=alert(2)>`,
    savedAt: saved,
  }]);
  assert.ok(!/<script/i.test(file));
  assert.ok(!/<img/i.test(file));
  assert.equal(file.match(/<A /g)?.length, 1);
  assert.equal(file.match(/<\/DL>/g)?.length, 1);
  assert.ok(file.includes("&lt;script&gt;alert(&quot;t&quot;)&lt;/script&gt; &amp; &#39;more&#39;</A>"));
  assert.ok(file.includes("<DD>&lt;/DL&gt;&lt;DT&gt;&lt;A HREF=&quot;javascript:alert(1)&quot;&gt;"));
});

test("an address cannot close its own attribute", () => {
  const file = render([{ url: `https://example.com/?q="><script>alert(1)</script>&x='y'`, title: "A", note: null, savedAt: saved }]);
  assert.ok(file.includes(`HREF="https://example.com/?q=&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;&amp;x=&#39;y&#39;" ADD_DATE=`));
  assert.ok(!file.includes("<script>"));
});

test("an address that is not a web address is left out", () => {
  const file = render([
    { url: "javascript:alert(1)", title: "Bad", note: "n", savedAt: saved },
    { url: "data:text/html,<script>alert(1)</script>", title: "Worse", note: null, savedAt: saved },
    { url: "https://example.com/ok", title: "Good", note: null, savedAt: saved },
  ]);
  assert.equal(file.match(/<DT>/g)?.length, 1);
  assert.ok(!file.includes("javascript:"));
  assert.ok(!file.includes("data:"));
  assert.equal(exportAddress("javascript:alert(1)", BASE), null);
  assert.equal(exportAddress("//evil.example/x", BASE), null);
});

test("a post saved under its page here gets this instance's address", () => {
  assert.equal(exportAddress("/feeds/12/some-site/345", BASE), "https://thicket.example/feeds/12/some-site/345");
  assert.ok(render([{ url: "/feeds/12/some-site/345", title: "A", note: null, savedAt: saved }]).includes(`HREF="https://thicket.example/feeds/12/some-site/345"`));
});

test("a bookmark with no title is named by its address, and a title is one line", () => {
  const file = render([
    { url: "https://example.com/untitled", title: null, note: null, savedAt: saved },
    { url: "https://example.com/b", title: "  Two\nlines\t here ", note: null, savedAt: saved },
  ]);
  assert.ok(file.includes(">https://example.com/untitled</A>"));
  assert.ok(file.includes(">Two lines here</A>"));
});

test("control characters are dropped, other languages and emoji are kept", () => {
  assert.equal(escapeHtml("a\u0000b\u0007c\u001Fd\te\nf"), "abcd\te\nf");
  const file = render([{ url: "https://example.com/a", title: "日本語のタイトル 🌿", note: "Zażółć gęślą jaźń", savedAt: saved }]);
  assert.ok(file.includes(">日本語のタイトル 🌿</A>"));
  assert.ok(file.includes("<DD>Zażółć gęślą jaźń"));
});

test("rows are written in the order given", () => {
  const file = render([
    { url: "https://example.com/new", title: "New", note: null, savedAt: saved },
    { url: "https://example.com/old", title: "Old", note: null, savedAt: new Date("2020-01-01T00:00:00Z") },
  ]);
  assert.ok(file.indexOf(">New</A>") < file.indexOf(">Old</A>"));
});
