import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import type { SQL } from "drizzle-orm";
import * as schema from "./schema.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

// int8 → number (ids are bigserial; we will not exceed 2^53 rows), timestamptz → ISO string.
// Applies to raw db.execute() results too, which is where the API reads from.
pg.types.setTypeParser(20, (v) => Number(v));
// int8[] (e.g. array_agg over ids) → number[]; reuse the int4[] parser, which yields numbers.
type Oid = Parameters<typeof pg.types.setTypeParser>[0];
const INT8_ARRAY = 1016 as Oid;
const INT4_ARRAY = 1007 as Oid;
pg.types.setTypeParser(INT8_ARRAY, (v) => pg.types.getTypeParser(INT4_ARRAY, "text")(v) as number[]);
pg.types.setTypeParser(1184, (v) => new Date(v).toISOString());

const env = (k: string, d: number) => Number(process.env[k] ?? d);

/**
 * Three pools, so one kind of work can never starve another of connections.
 * Measured on production 2026-10-11: with one shared pool of 10, ten searches
 * in flight made a trivial `select 1` wait 1.3 s for a connection, and the feed
 * fetcher was drawing from the same 10. Postgres itself allows 500.
 *
 *  - pool: what a request does while someone waits on it. Short statement
 *    timeout, and a request that can't get a connection within a few seconds
 *    fails (503) rather than queueing forever behind slower ones.
 *  - workerPool: the feed fetcher, retention, the counts job. Nobody is waiting
 *    on these, so they may take longer, but they can't crowd out a page load.
 *  - controlPool: one connection, used only to cancel a request's query when
 *    its client goes away (cancellable below). Kept apart so a cancel never
 *    waits behind the queries it is trying to stop.
 */
export const pool = new pg.Pool({
  connectionString: url,
  max: env("DB_POOL_MAX", 20),
  connectionTimeoutMillis: env("DB_CONNECT_TIMEOUT_MS", 5_000),
  statement_timeout: env("DB_STATEMENT_TIMEOUT_MS", 15_000),
  idle_in_transaction_session_timeout: 30_000,
});
export const workerPool = new pg.Pool({
  connectionString: url,
  max: env("DB_WORKER_POOL_MAX", 10),
  statement_timeout: env("DB_WORKER_STATEMENT_TIMEOUT_MS", 120_000),
  idle_in_transaction_session_timeout: 120_000,
});
const controlPool = new pg.Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 2_000 });

export const db = drizzle(pool, { schema });
export const workerDb = drizzle(workerPool, { schema });
export { schema };

export const endPools = () => Promise.all([pool.end(), workerPool.end(), controlPool.end()]);

/** Postgres's code for a statement stopped by statement_timeout or a cancel. */
export const QUERY_CANCELED = "57014";

/**
 * Did the database decline in time: a statement stopped by its timeout or a
 * cancel, or no connection free within the pool's wait? drizzle wraps the
 * driver's error ("Failed query: ..."), so the code may be on its cause.
 */
export function isDbBusy(err: unknown): boolean {
  for (let e = err as { code?: string; message?: string; cause?: unknown } | undefined, depth = 0; e && depth < 3; e = e.cause as typeof e, depth++) {
    if (e.code === QUERY_CANCELED || /timeout exceeded when trying to connect/i.test(e.message ?? "")) return true;
  }
  return false;
}

/**
 * Run one request's queries on a connection of its own that is cancelled in
 * Postgres the moment `signal` aborts — the browser moved on, so the answer
 * is wanted by nobody. Without this a dropped search kept running to the end
 * (production logged a 499 whose query went on for 6 s), holding a connection
 * the next search needed.
 *
 * A connection whose request was abandoned is closed rather than reused, and
 * only after the cancel has been delivered: a cancel that arrived late could
 * otherwise stop whatever the connection's next borrower was running.
 */
export async function cancellable<T>(signal: AbortSignal | undefined, run: (q: (query: SQL) => Promise<pg.QueryResult<any>>) => Promise<T>): Promise<T> {
  signal?.throwIfAborted();
  const client = await pool.connect();
  const scoped = drizzle(client, { schema });
  // The backend's pid, from the startup handshake; pg sets it but its types leave it out.
  const pid = (client as unknown as { processID: number }).processID;
  let cancelled: Promise<unknown> | null = null;
  const onAbort = () => { cancelled = controlPool.query("select pg_cancel_backend($1)", [pid]).catch(() => {}); };
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    return await run((query) => scoped.execute(query));
  } finally {
    signal?.removeEventListener("abort", onAbort);
    if (cancelled) await cancelled;
    client.release(cancelled !== null);
  }
}
