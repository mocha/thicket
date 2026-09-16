import { sql, type SQL } from "drizzle-orm";

/**
 * How many distinct feeds a collection holds, counting its sub-collections.
 * A parent is a place to read everything under it, so its number is the
 * whole tree, not just what was dropped directly into it.
 */
export const subtreeFeedCount = (col: SQL): SQL => sql`(
  select count(distinct cf.feed_id)::int from collection_feeds cf where cf.collection_id in (
    with recursive t as (select ${col} as id union all select c.id from collections c join t on c.parent_id = t.id) select id from t))`;
