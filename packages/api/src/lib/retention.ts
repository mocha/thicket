/**
 * Deleting what nobody reads, on a schedule.
 *
 * Three windows, with very different defaults, because they hold very
 * different things:
 *
 *  - **Fetch log and events are on by default (90 days).** Operational
 *    exhaust. Measured 2026-09-12, the fetch log grows *faster than the posts
 *    it logs* — 575 KB per feed per year against 486 KB of actual posts,
 *    because we write a row per attempt and 55% of attempts return nothing
 *    new. Nothing is lost by forgetting them.
 *
 *  - **Posts are off by default,** and that is deliberate. A feed is not an
 *    archive: it serves a window, usually its last 15 or 25 entries, so a post
 *    we delete can never be fetched again (see feeds/backfill.ts for how
 *    little history is actually reachable). Measured on a real instance, a
 *    180-day window would have deleted half the posts stored, and they were
 *    real archives — one personal blog alone publishes 514 posts going back
 *    to 2001. thicket ends up holding more history than the feeds themselves
 *    do, which is worth something. So an operator who wants the storage back has to ask
 *    for it by setting RETAIN_ITEMS_DAYS. Nobody's bookmarks or notes go
 *    with the posts: a bookmark keeps its own copy of the post, and a note is
 *    part of the bookmark (issue #84), so both outlive it.
 *
 * Deletes run in chunks so a big first pass never holds a long lock.
 */
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { RETAIN_EVENTS_DAYS, RETAIN_FETCH_LOG_DAYS, RETAIN_ITEMS_DAYS } from "./config.js";

const CHUNK = 5_000;
/** Stop after this many chunks in one pass; the next pass picks up where it left off. */
const MAX_CHUNKS = 40;

async function deleteInChunks(label: string, statement: (chunk: number) => ReturnType<typeof db.execute>): Promise<number> {
  let removed = 0;
  for (let i = 0; i < MAX_CHUNKS; i++) {
    const res = await statement(CHUNK);
    const n = res.rowCount ?? 0;
    removed += n;
    if (n < CHUNK) break;
  }
  if (removed) console.log(`[retention] removed ${removed} ${label}`);
  return removed;
}

export async function pruneOldData(): Promise<{ items: number; fetchLog: number; events: number }> {
  const out = { items: 0, fetchLog: 0, events: 0 };

  if (RETAIN_FETCH_LOG_DAYS > 0) {
    out.fetchLog = await deleteInChunks("fetch log rows", (chunk) => db.execute(sql`
      delete from fetch_log where ctid in (
        select ctid from fetch_log where at < now() - ${`${RETAIN_FETCH_LOG_DAYS} days`}::interval limit ${chunk})`));
  }

  if (RETAIN_EVENTS_DAYS > 0) {
    out.events = await deleteInChunks("events", (chunk) => db.execute(sql`
      delete from events where ctid in (
        select ctid from events where created_at < now() - ${`${RETAIN_EVENTS_DAYS} days`}::interval limit ${chunk})`));
  }

  if (RETAIN_ITEMS_DAYS > 0) {
    // No guard for bookmarked or noted posts: a bookmark keeps its own
    // snapshot, its note lives on it, and item_id is ON DELETE SET NULL, so
    // both survive by design.
    out.items = await deleteInChunks("posts", (chunk) => db.execute(sql`
      delete from items where ctid in (
        select i.ctid from items i
        where i.published_at < now() - ${`${RETAIN_ITEMS_DAYS} days`}::interval
        limit ${chunk})`));
  }

  return out;
}

/** Run once shortly after boot, then daily. Failures are logged, never fatal. */
export function startRetention(): void {
  const run = () => void pruneOldData().catch((e) => console.error("[retention] failed:", e));
  setTimeout(run, 60_000).unref();
  setInterval(run, 24 * 3600_000).unref();
}
