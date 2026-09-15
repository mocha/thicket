/**
 * Folding one feed row into another. A feed is the address being fetched
 * (DECISIONS 2026-09-13), so two rows whose fetches end at the same address
 * are one feed that was entered twice: www.polygon.com/rss/index.xml redirects
 * to www.polygon.com/feed/, and both were in the index, each posting the same
 * 51 posts a day.
 *
 * The row at the address the fetch actually lands on survives. Everything
 * people did with the other one moves to it: the collections it was filed in,
 * their settings on it, blocks, and the notes and bookmarks on its posts.
 * Posts the surviving feed already holds (same dedupe key, or failing that the
 * same link) are not copied; notes and bookmarks are pointed at its copy.
 *
 * The same folding ran once as SQL for YouTube's "No Shorts" feeds
 * (drizzle/0008_feed_settings.sql); this is the general form.
 */
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";

export async function mergeFeeds(fromId: number, intoId: number): Promise<void> {
  if (fromId === intoId) return;
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      insert into collection_feeds (collection_id, feed_id, added_at)
      select collection_id, ${intoId}, added_at from collection_feeds where feed_id = ${fromId}
      on conflict do nothing`);
    // Someone with settings on both keeps what they set on the surviving feed, and gains what they set only on the other.
    await tx.execute(sql`
      insert into feed_settings (user_id, feed_id, display_name, hide_shorts, created_at, updated_at)
      select user_id, ${intoId}, display_name, hide_shorts, created_at, now() from feed_settings where feed_id = ${fromId}
      on conflict (user_id, feed_id) do update set
        display_name = coalesce(feed_settings.display_name, excluded.display_name),
        hide_shorts = coalesce(feed_settings.hide_shorts, excluded.hide_shorts),
        updated_at = now()`);
    await tx.execute(sql`
      insert into blocks (user_id, feed_id) select user_id, ${intoId} from blocks where feed_id = ${fromId}
      on conflict do nothing`);

    // Each post on the old feed, and the surviving feed's copy of it if it has one.
    await tx.execute(sql`
      create temporary table merge_twins on commit drop as
      select i.id as old_id,
             (select j.id from items j
              where j.feed_id = ${intoId} and (j.dedupe_key = i.dedupe_key or (i.url is not null and j.url = i.url))
              order by (j.dedupe_key = i.dedupe_key) desc, j.id limit 1) as new_id
      from items i where i.feed_id = ${fromId}`);
    await tx.execute(sql`update items set feed_id = ${intoId} where id in (select old_id from merge_twins where new_id is null)`);
    // A note is one per person per post: someone who noted both copies keeps the one already on the surviving feed.
    await tx.execute(sql`
      update notes nt set item_id = t.new_id from merge_twins t
      where nt.item_id = t.old_id and t.new_id is not null
        and not exists (select 1 from notes y where y.user_id = nt.user_id and y.item_id = t.new_id)`);
    await tx.execute(sql`
      update bookmarks b set item_id = t.new_id from merge_twins t
      where b.item_id = t.old_id and t.new_id is not null`);
    await tx.execute(sql`update bookmarks set feed_id = ${intoId} where feed_id = ${fromId}`);
    await tx.execute(sql`update users set claimed_feed_id = ${intoId} where claimed_feed_id = ${fromId}`);
    await tx.execute(sql`
      update feeds g set last_item_at = greatest(g.last_item_at, f.last_item_at),
                         description = coalesce(g.description, f.description),
                         site_url = coalesce(g.site_url, f.site_url)
      from feeds f where g.id = ${intoId} and f.id = ${fromId}`);
    await tx.execute(sql`delete from feeds where id = ${fromId}`);
  });
  console.log(`[merge] feed ${fromId} folded into feed ${intoId}: both fetch the same address`);
}
