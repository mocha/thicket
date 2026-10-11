/**
 * The counts the lists sort by, kept on feeds and collections (drizzle/0029).
 *
 * Two kinds, kept two ways:
 *
 *  - **Totals** (feeds.follower_count, feeds.item_count,
 *    collections.feed_count) are recounted by triggers for whatever a write
 *    touched, so they are right the moment it commits; each recount locks the
 *    rows it counts first, so overlapping writers take turns rather than each
 *    missing the other's rows. `reconcile` recounts every row nightly anyway
 *    and logs anything it had to correct, because a count nobody checks drifts
 *    without anyone noticing. A non-zero drift in the log means a write path
 *    the triggers don't cover, and is worth a look.
 *
 *    These counts order and label lists; they never decide whether something
 *    is shown at all. That stays an exact check (routes/explore.ts).
 *
 *  - **Windows** (feeds.posts_30d, feeds.posts_90d) change because time
 *    passes, not because anything was written, so no trigger can keep them.
 *    `recountWindows` does, hourly. An hour stale is fine for a sort.
 *
 * Every update writes only rows whose number changed, so an hourly pass over
 * 8,000 feeds rewrites the few hundred that moved, not all of them.
 *
 * Run by hand with `pnpm recount` (scripts/recount.ts).
 */
import { sql } from "drizzle-orm";
import { workerDb as db } from "../db/client.js";

export type Drift = { followers: number; items: number; collections: number };

/** Recount posts in the last 30 and 90 days for every feed. Returns how many feeds changed. */
export async function recountWindows(): Promise<number> {
  const r = await db.execute(sql`
    update feeds f set posts_30d = n.d30, posts_90d = n.d90
    from (
      select f2.id, coalesce(w.d30, 0) as d30, coalesce(w.d90, 0) as d90
      from feeds f2 left join (
        select feed_id,
               count(*) filter (where published_at > now() - interval '30 days')::int as d30,
               count(*)::int as d90
        from items where published_at > now() - interval '90 days'
        group by feed_id
      ) w on w.feed_id = f2.id
    ) n
    where f.id = n.id and (f.posts_30d, f.posts_90d) is distinct from (n.d30, n.d90)`);
  return r.rowCount ?? 0;
}

/** Recount every trigger-kept total from scratch. Returns how many rows were wrong. */
export async function reconcile(): Promise<Drift> {
  const followers = await db.execute(sql`
    update feeds f set follower_count = n.c
    from (
      select f2.id, coalesce(x.c, 0) as c from feeds f2 left join (
        select cf.feed_id, count(distinct col.user_id)::int as c
        from collection_feeds cf join collections col on col.id = cf.collection_id group by cf.feed_id
      ) x on x.feed_id = f2.id
    ) n
    where f.id = n.id and f.follower_count <> n.c`);
  const items = await db.execute(sql`
    update feeds f set item_count = n.c
    from (
      select f2.id, coalesce(x.c, 0) as c from feeds f2
      left join (select feed_id, count(*)::int as c from items group by feed_id) x on x.feed_id = f2.id
    ) n
    where f.id = n.id and f.item_count <> n.c`);
  const collections = await db.execute(sql`
    update collections col set feed_count = n.c
    from (
      select c2.id, coalesce(x.c, 0) as c from collections c2
      left join (select collection_id, count(*)::int as c from collection_feeds group by collection_id) x on x.collection_id = c2.id
    ) n
    where col.id = n.id and col.feed_count <> n.c`);
  return { followers: followers.rowCount ?? 0, items: items.rowCount ?? 0, collections: collections.rowCount ?? 0 };
}

const HOUR = 3600_000;

/** Windows hourly, totals nightly. Both start a few minutes after boot. Failures are logged, never fatal. */
export function startCounts(): void {
  const windows = () => void recountWindows()
    .then((n) => { if (n) console.log(`[counts] recounted 30/90-day posts: ${n} feeds changed`); })
    .catch((e) => console.error("[counts] window recount failed:", e));
  const totals = () => void reconcile()
    .then((d) => {
      const n = d.followers + d.items + d.collections;
      // Drift means a trigger missed something; say so loudly enough to be found.
      if (n) console.warn(`[counts] reconcile corrected drift: ${d.followers} follower counts, ${d.items} post counts, ${d.collections} collection sizes`);
      else console.log("[counts] reconcile: no drift");
    })
    .catch((e) => console.error("[counts] reconcile failed:", e));
  setTimeout(windows, 2 * 60_000).unref();
  setInterval(windows, HOUR).unref();
  setTimeout(totals, 5 * 60_000).unref();
  setInterval(totals, 24 * HOUR).unref();
}
