import { sql } from "drizzle-orm";

/**
 * "Since": a window back from now over when a thing appeared, as every
 * Explore list takes it (?since=24h|week|month|year). What "appeared" means
 * is each list's own: a post's publish date, or the day a feed, a collection or
 * a person arrived on this instance. Anything else, including nothing, is any
 * time, so a mistyped link still loads.
 */
const SINCE_INTERVALS: Record<string, string> = { "24h": "1 day", week: "7 days", month: "30 days", year: "365 days" };
export const sinceIntervalFrom = (v: string | null | undefined): string | null =>
  Object.hasOwn(SINCE_INTERVALS, v ?? "") ? SINCE_INTERVALS[v as string] : null;
/** `col` falls inside the window; always true when there is no window. */
export const sinceSql = (col: string, interval: string | null) =>
  interval ? sql`${sql.raw(col)} > now() - ${interval}::interval` : sql`true`;
