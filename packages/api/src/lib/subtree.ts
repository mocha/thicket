import { sql, type SQL } from "drizzle-orm";

/**
 * How many distinct feeds a collection holds, counting its sub-collections.
 * A parent is a place to read everything under it, so its number is the
 * whole tree, not just what was dropped directly into it.
 */
export const subtreeFeedCount = (col: SQL): SQL => sql`(
  select count(distinct cf.feed_id)::int from collection_feeds cf where cf.collection_id in (
    with recursive t as (select ${col} as id union all select c.id from collections c join t on c.parent_id = t.id) select id from t))`;

/**
 * A few of a collection's feeds, most recently posting first, for the
 * overlapped icons at the front of its row: id, name, and whether it has an
 * icon of its own. Only feeds filed directly in it: a sub-collection can be
 * shared less widely than its parent, so reaching into it would show a
 * visitor feeds they may not see. A collection that only holds other
 * collections gets no icons.
 */
export const collectionSample = (col: SQL, limit = 3): SQL => sql`(select coalesce(json_agg(x), '[]'::json) from (
  select f.id, coalesce(cf.title_override, f.title) as title,
         exists(select 1 from feed_icons fi where fi.feed_id = f.id and not fi.generic) as "hasIcon"
  from collection_feeds cf join feeds f on f.id = cf.feed_id
  where cf.collection_id = ${col} order by f.last_item_at desc nulls last limit ${limit}) x)`;
