/**
 * Keeping useful history and pruning the rest, on a schedule.
 *
 * Three windows, with very different defaults, because they hold very
 * different things:
 *
 *  - **Fetch log defaults to 14 days (issue #259).** Recent attempts support
 *    feed-failure and recovery investigations, host-level 403/429 checks
 *    around deploys, and comparisons between two rolling seven-day windows.
 *    Scheduling and politeness use current feed state and host_cooldowns,
 *    not this history. Keep every outcome: successful checks with no new
 *    posts establish recovery, failure-rate denominators, and polling yield.
 *    Preserve evidence for longer incident investigations separately; add
 *    longer-lived summaries only when a concrete consumer needs them.
 *
 *    Measured 2026-09-12, the fetch log grows *faster than the posts
 *    it logs* — 575 KB per feed per year against 486 KB of actual posts,
 *    because we write a row per attempt and 55% of attempts return nothing
 *    new. Measured 2026-10-09: 75,000 attempts/day across 8,439 feeds,
 *    about 134 bytes/row including indexes. At twice that fetch volume
 *    (Kagi Pass 2), 14 days holds about 2.1M rows / 281 MB, versus 13.5M
 *    rows / 1.81 GB for 90 days. Hourly pruning limits overshoot; cleanup
 *    backlog and dead tuples can add more.
 *
 *  - **Events default to 90 days.** Product analytics with their own window.
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
import type pg from "pg";
// Background work: the worker pool, so fetching never takes a request's connection (db/client.ts).
import { workerDb as db, workerPool } from "../db/client.js";
import { RETAIN_EVENTS_DAYS, RETAIN_FETCH_LOG_DAYS, RETAIN_ITEMS_DAYS } from "./config.js";

const CHUNK = 5_000;
/** Stop after this many chunks in one pass; the next pass picks up where it left off. */
const MAX_CHUNKS = 40;
export const FETCH_LOG_INTERVAL_MS = 3600_000;
/** A soft wall-clock budget, checked between chunks; each delete also has a 10s statement timeout. */
const FETCH_LOG_BUDGET_MS = 30_000;
// Session lock, deliberately distinct from the migration runner's transaction lock.
export const FETCH_LOG_LOCK = [0x74686963, 0x666c6f67] as const;
let fetchLogRunning = false;
let dailyRunning = false;

export type FetchLogPruneResult = {
  removed: number;
  chunks: number;
  cutoff: string | null;
  backlog: boolean;
  budgetExhausted: boolean;
  skipped: "disabled" | "overlap" | null;
  elapsedMs: number;
};

/**
 * One cutoff, at most 200k rows, every hour: 4.8M rows/day of row-budget
 * capacity, rather than the old 200k/day. Actual throughput depends on the DB.
 * A reserved worker session holds a nonblocking advisory lock across chunks,
 * so replicas cooperate without one huge delete transaction. Direct/session
 * pooling is required (as elsewhere in the API), not transaction pooling.
 *
 * Options permit isolated database tests without changing the application pool.
 */
export async function pruneFetchLog({
  days = RETAIN_FETCH_LOG_DAYS,
  pool = workerPool,
}: { days?: number; pool?: Pick<pg.Pool, "connect"> } = {}): Promise<FetchLogPruneResult> {
  const result: FetchLogPruneResult = {
    removed: 0, chunks: 0, cutoff: null, backlog: false,
    budgetExhausted: false, skipped: null, elapsedMs: 0,
  };
  if (!(days > 0)) return { ...result, skipped: "disabled" };
  if (fetchLogRunning) return { ...result, skipped: "overlap" };
  fetchLogRunning = true;
  const started = Date.now();
  let client: pg.PoolClient | undefined;
  let locked = false;
  let destroy = false;
  try {
    client = await pool.connect();
    locked = (await client.query<{ locked: boolean }>(
      "select pg_try_advisory_lock($1, $2) as locked", [...FETCH_LOG_LOCK],
    )).rows[0].locked;
    if (!locked) return { ...result, skipped: "overlap", elapsedMs: Date.now() - started };

    // Use the database clock, preserving full timestamp precision for every chunk.
    result.cutoff = (await client.query<{ cutoff: string }>(
      "select (now() - ($1::double precision * interval '1 day'))::text as cutoff", [days],
    )).rows[0].cutoff;
    while (result.chunks < MAX_CHUNKS && Date.now() - started < FETCH_LOG_BUDGET_MS) {
      // Commit every chunk; local timeouts never leak into the worker pool.
      await client.query("begin");
      try {
        await client.query("set local statement_timeout = '10s'; set local lock_timeout = '1s'");
        const deleted = await client.query(
          `delete from fetch_log where ctid in (
            select ctid from fetch_log where at < $1::timestamptz order by at limit $2
          )`, [result.cutoff, CHUNK],
        );
        await client.query("commit");
        result.chunks++;
        result.removed += deleted.rowCount ?? 0;
        if ((deleted.rowCount ?? 0) < CHUNK) break;
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    }
    result.backlog = (await client.query<{ backlog: boolean }>(
      "select exists(select 1 from fetch_log where at < $1::timestamptz) as backlog", [result.cutoff],
    )).rows[0].backlog;
    result.elapsedMs = Date.now() - started;
    result.budgetExhausted = result.backlog &&
      (result.chunks === MAX_CHUNKS || result.elapsedMs >= FETCH_LOG_BUDGET_MS);
    const report = `[retention] fetch log ${JSON.stringify(result)}`;
    if (result.backlog) console.warn(report);
    else console.log(report);
    return result;
  } catch (error) {
    // Release a potentially failed session rather than risk leaving a lock or
    // transaction on a pooled connection. Committed chunks remain committed.
    destroy = true;
    console.error(`[retention] fetch log failed after ${result.removed} rows / ${result.chunks} chunks; backlog unknown; retry next hour`);
    throw error;
  } finally {
    try {
      if (client && locked && !destroy) {
        const unlocked = await client.query<{ unlocked: boolean }>(
          "select pg_advisory_unlock($1, $2) as unlocked", [...FETCH_LOG_LOCK],
        );
        destroy = !unlocked.rows[0].unlocked;
      }
    } catch (error) {
      destroy = true;
      throw error;
    } finally {
      client?.release(destroy);
      fetchLogRunning = false;
    }
  }
}

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

async function pruneDailyData(): Promise<{ items: number; events: number }> {
  const out = { items: 0, events: 0 };
  if (dailyRunning) return out;
  dailyRunning = true;
  try {
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
  } finally {
    dailyRunning = false;
  }
}

/** Explicit combined pass for callers; scheduling keeps daily policies separate. */
export async function pruneOldData(): Promise<{ items: number; fetchLog: number; events: number }> {
  const fetchLog = await pruneFetchLog();
  return { ...await pruneDailyData(), fetchLog: fetchLog.removed };
}

/** Boot after one minute; fetch logs hourly, events/posts daily. Failures are nonfatal. */
export function startRetention(): void {
  const fetchLog = () => void pruneFetchLog().catch((e) => console.error("[retention] fetch log failed:", e));
  const daily = () => void pruneDailyData().catch((e) => console.error("[retention] daily failed:", e));
  setTimeout(fetchLog, 60_000).unref();
  setInterval(fetchLog, FETCH_LOG_INTERVAL_MS).unref();
  setTimeout(daily, 60_000).unref();
  setInterval(daily, 24 * 3600_000).unref();
}
