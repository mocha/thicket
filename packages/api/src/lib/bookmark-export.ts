/**
 * My bookmarks and notes as a file I can take anywhere (issue #135). The
 * skeleton is the old "Netscape Bookmark File": the one every browser writes
 * when you export bookmarks, and the one browsers, Pinboard, Raindrop and
 * Linkding all read. One entry per bookmark: a link with its address, its
 * title and the time it was saved, and under it a description.
 *
 * The description is where everything else goes, because the format has no
 * place of its own for an author, a site or the day a post came out. It is
 * up to three short paragraphs, so the file reads well to a person who opens
 * it and to a program that is handed it:
 *
 *   <p class="byline">By Ford James for Polygon.com, posted <time …>…</time></p>
 *   <p class="note"><em>My note:</em> …</p>
 *   <p class="saved">Bookmarked <time …>…</time></p>
 *
 * A small stylesheet in the head makes that pleasant in a browser. Importers
 * that keep a description as plain text may show those tags as written; the
 * words still read in order. Never a heading tag in an entry: in this format
 * <H3> means a folder.
 *
 * The file is HTML, and people open it in a browser, so nothing a feed or a
 * person typed may reach it unescaped: a title of `<script>` has to arrive as
 * those eight characters and not as a script. The only markup in the file is
 * the markup written here.
 *
 * Nothing here touches the database: the route reads the rows, this turns
 * them into the file, and the tests beside it run without one.
 */
import { PUBLIC_URL } from "./config.js";
import { isHttpUrl } from "../feeds/normalize.js";

/**
 * The most bookmarks one export holds: the most recently saved ones. A
 * ceiling on the work one request can ask for, not a plan limit. It is far
 * above what the file can carry comfortably: measured on 2026-10-01, 20,000
 * bookmarks came to a 6 MB file in about 150 ms, database read included.
 */
export const EXPORT_MAX = 10_000;

export type ExportRow = {
  url: string; title: string | null; note: string | null; savedAt: Date | string;
  author?: string | null; siteTitle?: string | null; publishedAt?: Date | string | null;
};

export type ExportOptions = {
  /** Whose bookmarks these are, for the file's title. */
  handle: string;
  /** The reader's timezone as the browser names it ("America/Chicago"). Anything else is UTC. */
  timeZone?: string | null;
  /** This instance's address. Defaults to PUBLIC_URL; tests pass their own. */
  base?: string;
};

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
 * The timezone to write times in: the one asked for when it is a real one,
 * UTC otherwise. The name arrives in the address of the download, so it is
 * checked the only sure way, by asking the date formatter to use it.
 */
export function exportTimeZone(asked: string | null | undefined): string {
  if (!asked || asked.length > 64 || !/^[A-Za-z0-9_+\-/]+$/.test(asked)) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: asked });
    return asked;
  } catch {
    return "UTC";
  }
}

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th")}`;

/**
 * The two formatters a timezone needs, kept: making one costs far more than
 * using it, and a file uses them thousands of times. One writes the words a
 * person reads, the other the numbers for the machine-readable time.
 */
const formatters = new Map<string, { words: Intl.DateTimeFormat; numbers: Intl.DateTimeFormat }>();
function formatter(timeZone: string) {
  let f = formatters.get(timeZone);
  if (!f) {
    if (formatters.size > 50) formatters.clear();
    f = {
      words: new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true }),
      numbers: new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
    };
    formatters.set(timeZone, f);
  }
  return f;
}
const part = (parts: Intl.DateTimeFormatPart[], type: string) => parts.find((x) => x.type === type)?.value ?? "";

/**
 * A moment in the reader's timezone, both ways: `text` is for people
 * ("October 12th, 2026 at 9:33am", with "UTC" after it when that is the
 * zone), `iso` is the same wall-clock time with its distance from UTC
 * ("2026-10-12T09:33-05:00", or ending in Z for UTC), for <time datetime>.
 */
export function exportTime(date: Date, timeZone: string): { text: string; iso: string } {
  const f = formatter(timeZone);
  const w = f.words.formatToParts(date);
  const text = `${part(w, "month")} ${ordinal(Number(part(w, "day")))}, ${part(w, "year")} at ${part(w, "hour")}:${part(w, "minute")}${part(w, "dayPeriod").toLowerCase()}${timeZone === "UTC" ? " UTC" : ""}`;
  const n = f.numbers.formatToParts(date);
  const [y, mo, d, h, mi] = ["year", "month", "day", "hour", "minute"].map((t) => part(n, t));
  // How far the wall clock stands from UTC: read the wall clock as if it were UTC and compare, to the minute.
  const off = Math.round((Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi)) - Math.floor(date.getTime() / 60000) * 60000) / 60000);
  const two = (v: number) => String(v).padStart(2, "0");
  const zone = timeZone === "UTC" ? "Z" : `${off < 0 ? "-" : "+"}${two(Math.floor(Math.abs(off) / 60))}:${two(Math.abs(off) % 60)}`;
  return { text, iso: `${y}-${mo}-${d}T${h}:${mi}${zone}` };
}

const validDate = (v: Date | string | null | undefined): Date | null => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
};
const oneLine = (v: string | null | undefined) => v?.replace(/\s+/g, " ").trim() || null;
const timeTag = (date: Date, timeZone: string) => {
  const t = exportTime(date, timeZone);
  return `<time datetime="${t.iso}">${escapeHtml(t.text)}</time>`;
};

/**
 * Who wrote the post, for which site, and when it came out, as the HTML that
 * goes inside the byline paragraph, already escaped. The parts that are
 * missing are left out and the rest still reads as a line of its own:
 * "By A for S, posted T", "By A", "From S, posted T", "Posted T". Null for a
 * bare address with none of the three.
 */
export function bylineHtml(row: ExportRow, timeZone: string): string | null {
  const author = oneLine(row.author);
  const site = oneLine(row.siteTitle);
  const posted = validDate(row.publishedAt);
  const who = author ? `By ${escapeHtml(author)}${site ? ` for ${escapeHtml(site)}` : ""}` : site ? `From ${escapeHtml(site)}` : "";
  if (!posted) return who || null;
  return who ? `${who}, posted ${timeTag(posted, timeZone)}` : `Posted ${timeTag(posted, timeZone)}`;
}

/**
 * A bookmark's description: the paragraphs under its link, each a piece of
 * HTML, already escaped. The byline when there is anything to say, my note
 * when I wrote one, and always when it was bookmarked, year and all.
 *
 * The note is written as I typed it. Notes are Markdown, and it stays
 * Markdown: the source reads fine as it is and the next place it lands may
 * render it. Its line breaks are kept as line breaks, which the stylesheet
 * shows (white-space: pre-wrap) and plain text keeps for free.
 */
export function describeBookmark(row: ExportRow, timeZone: string): string[] {
  const out: string[] = [];
  const byline = bylineHtml(row, timeZone);
  if (byline) out.push(`<p class="byline">${byline}</p>`);
  const note = row.note?.trim();
  if (note) out.push(`<p class="note"><em>My note:</em> ${escapeHtml(note)}</p>`);
  const saved = validDate(row.savedAt);
  if (saved) out.push(`<p class="saved">Bookmarked ${timeTag(saved, timeZone)}</p>`);
  return out;
}

/**
 * How the file looks when someone opens it in a browser: the link as the
 * entry's heading, the byline and saved lines quiet, the note set apart, a
 * comfortable column, light or dark to match the device. Nothing in it comes
 * from a person or a feed, and it asks for nothing from the network.
 */
const STYLE = `<STYLE>
  :root { color-scheme: light dark; --text: #1d1b16; --muted: #6f6a5f; --line: #e3ddd0; --bg: #f5f1e8; --card: #fffdf8; --link: #2f5d3a; }
  @media (prefers-color-scheme: dark) { :root { --text: #ece8de; --muted: #a39d8f; --line: #3a372f; --bg: #171612; --card: #24221c; --link: #9fcfa8; } }
  body { max-width: 44rem; margin: 0 auto; padding: 2rem 1rem 4rem; background: var(--bg); color: var(--text); font: 1rem/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  h1 { font-size: 1.5rem; line-height: 1.25; margin: 0 0 1.5rem; }
  dl, dd { margin: 0; }
  dl > p { display: none; }
  dt { margin-top: 1.5rem; padding-top: 1.5rem; border-top: 1px solid var(--line); }
  dt:first-of-type { margin-top: 0; padding-top: 0; border-top: 0; }
  dt a { font-size: 1.2rem; font-weight: 650; line-height: 1.3; color: var(--link); text-decoration: none; overflow-wrap: anywhere; }
  dt a:hover { text-decoration: underline; }
  dd p { margin: 0.35rem 0 0; overflow-wrap: anywhere; }
  .byline, .saved { color: var(--muted); font-size: 0.875rem; }
  .note { white-space: pre-wrap; margin: 0.6rem 0; padding: 0.6rem 0.9rem; background: var(--card); border-left: 3px solid var(--link); border-radius: 0 0.4rem 0.4rem 0; }
  .note em { font-style: normal; font-weight: 650; }
</STYLE>`;

/** The file's own name for itself: "@handle's bookmarks from readthicket.com". */
export function exportTitle(handle: string, base: string = PUBLIC_URL): string {
  let host = base;
  try { host = new URL(base).host; } catch { /* an address we can't read is written as it is */ }
  return `@${handle}'s bookmarks from ${host}`;
}

/**
 * The file itself. Rows come newest first and are written in that order.
 * The header lines are the ones browsers write, word for word, because some
 * importers look for them; the title, the heading and the stylesheet are ours.
 */
export function renderBookmarkFile(rows: ExportRow[], opts: ExportOptions): string {
  const base = opts.base ?? PUBLIC_URL;
  const timeZone = exportTimeZone(opts.timeZone);
  const heading = escapeHtml(exportTitle(opts.handle, base));
  const out: string[] = [
    "<!DOCTYPE NETSCAPE-Bookmark-file-1>",
    "<!-- This is an automatically generated file.",
    "     It will be read and overwritten.",
    "     DO NOT EDIT! -->",
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    // Not one of the browsers' lines: without it a phone shows the file as a shrunken desktop page.
    '<META NAME="viewport" CONTENT="width=device-width, initial-scale=1">',
    `<TITLE>${heading}</TITLE>`,
    STYLE,
    `<H1>${heading}</H1>`,
    "<DL><p>",
  ];
  for (const r of rows) {
    const href = exportAddress(r.url, base);
    if (!href) continue;
    const saved = Math.floor(new Date(r.savedAt).getTime() / 1000);
    const title = oneLine(r.title) ?? href;
    out.push(`    <DT><A HREF="${escapeHtml(href)}" ADD_DATE="${Number.isFinite(saved) ? saved : 0}">${escapeHtml(title)}</A>`);
    const paragraphs = describeBookmark(r, timeZone);
    if (paragraphs.length) out.push("    <DD>", ...paragraphs.map((p) => `      ${p}`));
  }
  out.push("</DL><p>", "");
  return out.join("\n");
}
