/**
 * The words of a bookmark that a browser can send: the address and title of
 * one saved by hand, and the whole card when a removal is undone. Each has a
 * length limit (MAX_LENGTH in lib/ratelimit.ts; issue #136). Over-long is
 * refused and says so. It is never cut short, because a bookmark that came
 * back shorter than it left would be a quiet loss.
 *
 * Pure: no database, so it is tested on its own (bookmark-fields.test.ts).
 */
import { MAX_LENGTH } from "./ratelimit.js";

/** What each field is called when talking to a person. */
const NAMES = {
  url: "address",
  title: "title",
  summary: "summary",
  author: "author",
  siteTitle: "site name",
  imageUrl: "image address",
} as const;

export type BookmarkField = keyof typeof NAMES;
export const BOOKMARK_FIELDS = Object.keys(NAMES) as BookmarkField[];

const count = (n: number) => n.toLocaleString("en-US");

/**
 * Why these values can't be saved, or null when they can. Only the fields
 * present are looked at; null and undefined mean "none" and always pass.
 */
export function fieldProblem(values: Partial<Record<BookmarkField, unknown>>): string | null {
  for (const field of BOOKMARK_FIELDS) {
    const v = values[field];
    if (v === null || v === undefined) continue;
    if (typeof v !== "string") return `The ${NAMES[field]} has to be text.`;
    const max = MAX_LENGTH[field];
    if (v.length > max) return `That ${NAMES[field]} is too long to save: ${count(v.length)} characters, and the most is ${count(max)}.`;
  }
  return null;
}
