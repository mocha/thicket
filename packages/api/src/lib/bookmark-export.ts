/**
 * My bookmarks and notes as a file I can take anywhere (issue #135). The
 * format is the old "Netscape Bookmark File": the one every browser writes
 * when you export bookmarks, and the one browsers, Pinboard, Raindrop and
 * Linkding all read. One entry per bookmark: its address, its title and the
 * time it was saved, and under it a description.
 *
 * The description is where everything else goes, because the format has no
 * place of its own for an author, a site or the day a post came out. It opens
 * with a sentence saying those ("Posted on October 12th, 2026 at 9:33am by
 * Ford James for Polygon.com. Bookmarked on October 13th at 11:32am."), and
 * my note, when I wrote one, follows after a blank line as "Note: …". The
 * lead-in is there because a browser showing the file, and some importers,
 * fold the blank line away; the word still marks where my own words begin.
 *
 * The file is HTML, and people open it in a browser, so nothing a feed or a
 * person typed may reach it unescaped: a title of `<script>` has to arrive as
 * those eight characters and not as a script.
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

/** One formatter per timezone, kept: making one costs far more than using it, and a file uses it thousands of times. */
const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    if (formatters.size > 50) formatters.clear();
    f = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
    formatters.set(timeZone, f);
  }
  return f;
}

/** "October 12th, 2026 at 9:33am", with the year left off when asked, and "UTC" after the time when that is the zone. */
function when(date: Date, timeZone: string, withYear: boolean): { text: string; year: number } {
  const parts = formatter(timeZone).formatToParts(date);
  const p = (type: string) => parts.find((x) => x.type === type)?.value ?? "";
  const year = Number(p("year"));
  const day = `${p("month")} ${ordinal(Number(p("day")))}${withYear ? `, ${year}` : ""}`;
  return { text: `${day} at ${p("hour")}:${p("minute")}${p("dayPeriod").toLowerCase()}${timeZone === "UTC" ? " UTC" : ""}`, year };
}

const validDate = (v: Date | string | null | undefined): Date | null => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
};
const oneLine = (v: string | null | undefined) => v?.replace(/\s+/g, " ").trim() || null;

/**
 * The sentence that opens a bookmark's description, as plain text (the caller
 * escapes it). The parts that are missing are left out: no "by" without an
 * author, no "for" without a site, and no "Posted" sentence at all for a
 * bare address with none of the three. The bookmarked date carries its year
 * only when the reader could not otherwise tell it: when the post has no
 * date, or was posted in a different year.
 */
export function describeBookmark(row: ExportRow, timeZone: string): string {
  const posted = validDate(row.publishedAt);
  const saved = validDate(row.savedAt);
  const author = oneLine(row.author);
  const site = oneLine(row.siteTitle);
  const out: string[] = [];
  const postedAt = posted ? when(posted, timeZone, true) : null;
  if (postedAt || author || site) {
    // A site name often ends in a full stop of its own ("Example Inc."); one is enough.
    const words = `Posted${postedAt ? ` on ${postedAt.text}` : ""}${author ? ` by ${author}` : ""}${site ? ` for ${site}` : ""}`;
    out.push(/[.!?]$/.test(words) ? words : `${words}.`);
  }
  if (saved) {
    const year = when(saved, timeZone, true).year;
    out.push(`Bookmarked on ${when(saved, timeZone, !postedAt || postedAt.year !== year).text}.`);
  }
  return out.join(" ");
}

/** The file's own name for itself: "@handle's bookmarks from readthicket.com". */
export function exportTitle(handle: string, base: string = PUBLIC_URL): string {
  let host = base;
  try { host = new URL(base).host; } catch { /* an address we can't read is written as it is */ }
  return `@${handle}'s bookmarks from ${host}`;
}

/**
 * The file itself. Rows come newest first and are written in that order.
 * The header lines are the ones browsers write, word for word, because some
 * importers look for them; only the title and heading are ours.
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
    `<TITLE>${heading}</TITLE>`,
    `<H1>${heading}</H1>`,
    "<DL><p>",
  ];
  for (const r of rows) {
    const href = exportAddress(r.url, base);
    if (!href) continue;
    const saved = Math.floor(new Date(r.savedAt).getTime() / 1000);
    const title = oneLine(r.title) ?? href;
    out.push(`    <DT><A HREF="${escapeHtml(href)}" ADD_DATE="${Number.isFinite(saved) ? saved : 0}">${escapeHtml(title)}</A>`);
    const about = describeBookmark(r, timeZone);
    const note = r.note?.trim();
    const description = [about, note ? `Note: ${note}` : ""].filter(Boolean).join("\n\n");
    if (description) out.push(`    <DD>${escapeHtml(description)}`);
  }
  out.push("</DL><p>", "");
  return out.join("\n");
}
