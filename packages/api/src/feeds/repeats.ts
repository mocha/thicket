/**
 * Reposts: a feed publishing again something it already published. BBC Sport
 * changes a counter on a post's id each time it edits a story, so the same
 * story arrives as a new post (96 of its 137 posts on 2026-09-14 were repeats);
 * podcasts re-air episodes; some sites publish every article under two paths.
 *
 * Nothing is hidden. A repeat is recorded against the earlier posts it repeats
 * (item_repeats), the post says so where it is read, and the feed's stats count
 * them, so a feed that mostly repeats itself shows as one.
 *
 * The match is cheap and deliberately conservative, and only ever within one
 * feed. A post repeats an earlier one when:
 * - their titles are the same, ignoring case, spacing and punctuation, and the
 *   title has at least four letters or digits; and
 * - they share a link, or have the same summary, or summaries at least 60%
 *   alike (trigram similarity over the first 300 characters).
 * The second condition is what keeps a weekly "Open thread" with new text each
 * week from counting as a repeat of last week's.
 *
 * On the dev copy of the index (~76,000 posts, 2026-09-15) this flags 403 posts
 * in 85 feeds, 0.5%: BBC Sport, podcast reruns, articles posted under two
 * paths, Tumblr reblogs.
 */
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";

/** Must stay byte-identical to the expression in items_feed_titlekey_idx (drizzle/0011_item_repeats.sql), or the index goes unused. */
const titleKey = (alias: "o" | "n") => sql.raw(`lower(regexp_replace(${alias}.title, '[^[:alnum:]]+', '', 'g'))`);

const alike = sql`(o.url = n.url or coalesce(o.summary, '') = coalesce(n.summary, '') or similarity(left(o.summary, 300), left(n.summary, 300)) >= 0.6)`;

/** Flag which of these just-stored posts repeat earlier posts on their feed. */
export async function markRepeats(itemIds: number[]): Promise<void> {
  if (!itemIds.length) return;
  const ids = sql`${`{${itemIds.join(",")}}`}::bigint[]`;
  // The usual case: a new post repeating older ones. At most the five most recent are recorded.
  await db.execute(sql`
    insert into item_repeats (item_id, of_item_id)
    select n.id, o.id from items n
    cross join lateral (
      select o.id from items o
      where o.feed_id = n.feed_id and ${titleKey("o")} = ${titleKey("n")}
        and (o.published_at, o.id) < (n.published_at, n.id) and ${alike}
      order by o.published_at desc limit 5
    ) o
    where n.id = any(${ids}) and n.title is not null and length(${titleKey("n")}) >= 4
    on conflict do nothing`);
  // The rarer one: a post dated before ones we already hold (history filled in later) is their original.
  await db.execute(sql`
    insert into item_repeats (item_id, of_item_id)
    select o.id, n.id from items n
    join items o on o.feed_id = n.feed_id and ${titleKey("o")} = ${titleKey("n")}
      and (o.published_at, o.id) > (n.published_at, n.id) and ${alike}
    where n.id = any(${ids}) and n.title is not null and length(${titleKey("n")}) >= 4
      and o.id <> all(${ids})
    on conflict do nothing`);
}
