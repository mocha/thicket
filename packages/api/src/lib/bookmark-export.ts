/**
 * My bookmarks and notes as a file I can take anywhere (issue #135). The
 * format is the old "Netscape Bookmark File": the one every browser writes
 * when you export bookmarks, and the one browsers, Pinboard, Raindrop and
 * Linkding all read. One entry per bookmark: its address, its title, the day
 * it was saved, and my note on it as the entry's description.
 *
 * The file is HTML, and people open it in a browser, so nothing a feed or a
 * person typed may reach it unescaped: a title of `<script>` has to arrive as
 * those eight characters and not as a script.
 *
 * Nothing here touches the database: the route reads the rows, this turns
 * them into the file, and the tests beside it run without one.
 *
 * There is no limit on how many bookmarks an export holds. Measured on
 * 2026-10-01: 5,000 bookmarks, every fourth with a note, is a 1.5 MB file
 * that downloads in about 50 ms, database read included; 20,000 is 6 MB in
 * about 150 ms; 100,000 is 30 MB and takes under half a second to write.
 * Nobody saves enough for the file to be the problem, so a limit would only
 * ever cut short the one promise this makes: that you can leave with all of it.
 */
import { PUBLIC_URL } from "./config.js";
import { isHttpUrl } from "../feeds/normalize.js";

export type ExportRow = { url: string; title: string | null; note: string | null; savedAt: Date | string };

/**
 * Text made safe to sit inside the file, in an attribute or between tags.
 * Control characters go too (all but tab and line break): they mean nothing
 * in a title or a note and some importers stop reading at one.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * The address to write for a bookmark, or null when it has none that is safe
 * to click. A post with no link of its own is saved under its page here
 * (/feeds/...), which only means something with this instance's address in
 * front of it. Anything else has to be a web address: a javascript: address
 * would run code when clicked, so it is left out of the file.
 */
export function exportAddress(url: string, base: string = PUBLIC_URL): string | null {
  if (/^\/(?!\/)/.test(url)) return `${base}${url}`;
  return isHttpUrl(url) ? url : null;
}

/**
 * The file itself. Rows come newest first and are written in that order.
 * The header lines are the ones browsers write, word for word, because some
 * importers look for them.
 */
export function renderBookmarkFile(rows: ExportRow[], base: string = PUBLIC_URL): string {
  const out: string[] = [
    "<!DOCTYPE NETSCAPE-Bookmark-file-1>",
    "<!-- This is an automatically generated file.",
    "     It will be read and overwritten.",
    "     DO NOT EDIT! -->",
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    "<TITLE>Bookmarks</TITLE>",
    "<H1>Bookmarks</H1>",
    "<DL><p>",
  ];
  for (const r of rows) {
    const href = exportAddress(r.url, base);
    if (!href) continue;
    const saved = Math.floor(new Date(r.savedAt).getTime() / 1000);
    const title = r.title?.replace(/\s+/g, " ").trim() || href;
    out.push(`    <DT><A HREF="${escapeHtml(href)}" ADD_DATE="${Number.isFinite(saved) ? saved : 0}">${escapeHtml(title)}</A>`);
    const note = r.note?.trim();
    if (note) out.push(`    <DD>${escapeHtml(note)}`);
  }
  out.push("</DL><p>", "");
  return out.join("\n");
}
