/**
 * What a person has been up to, as one time-ordered list: feeds added to
 * collections, collections made, posts bookmarked, notes written.
 *
 * The source is the domain tables and their own timestamps. Deliberately **not**
 * `events`, which already carries rows with the right-looking names: that table
 * is product analytics, gated by an instance flag and each person's own opt-out
 * (so it is empty for anyone who declined), and it also records what people
 * *looked at* — `river_view`, `item_opened`, `source_opened`. This is what
 * someone did, not what they read.
 *
 * This function takes a viewer and applies that viewer's permissions. When the
 * feed document ships it must be its own function, taking nobody and applying
 * the public filter — see docs/DECISIONS.md, "Every public page is also a feed,
 * and a feed carries only what is public to everyone". One function called with
 * `viewer = null` is a single bug away from publishing what that rule exists to
 * protect.
 *
 * Nothing here is stored. The list is derived, so unsaving a bookmark, deleting
 * a note or making a collection private withdraws the entry by itself: no
 * tombstones, no second deletion path, no log that remembers what someone
 * retracted.
 */
import { sql } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import { allowedLevelsSql, allows, type Audience } from "./visibility.js";

type Owner = typeof schema.users.$inferSelect;

/**
 * Feeds added to one collection inside this window collapse into a single
 * entry. Importing an OPML or copying a collection is one act by the person,
 * and without this it is one row per feed — hundreds of them, burying
 * everything else they have ever done.
 */
const BURST = "10 minutes";
/** Feeds named inside a collapsed entry. The rest become "and N more". */
const NAMED = 5;

export type ActivityEntry = { kind: "feeds" | "collection" | "bookmark" | "note"; at: string; id: number; payload: Record<string, unknown> };

const ICON = (col: string) => sql`exists(select 1 from feed_icons fi where fi.feed_id = ${sql.raw(col)} and not fi.generic)`;

export async function activityForViewer(
  u: Owner,
  who: Audience,
  opts: { limit: number; before?: string | null },
): Promise<{ entries: ActivityEntry[]; nextCursor: string | null }> {
  // The activity list has its own audience, and it caps everything below: if
  // this viewer isn't in it, there is no list at all, whatever the sections
  // underneath would otherwise allow.
  if (!allows(u.activityVisibility, who)) return { entries: [], nextCursor: null };
  // Each source is then admitted or excluded whole, by whether this viewer is
  // in that section's audience. The shape of the query stays the same either
  // way; Postgres prunes the branch.
  const on = (level: typeof u.notesVisibility) => (allows(level, who) ? sql`true` : sql`false`);
  const showCollections = on(u.collectionsVisibility);
  const showBookmarks = on(u.bookmarksVisibility);
  const showNotes = on(u.notesVisibility);
  // A collection narrower than the section is the owner's business: visible
  // to them, and to whoever it is shared with, the same rule the Collections
  // section already applies.
  const colVisible = sql`and ${allowedLevelsSql("col.visibility", who)}`;

  let cursor = sql``;
  if (opts.before) {
    const [ts, kind, id] = opts.before.split("|");
    if (ts && kind && id) cursor = sql`where (at, kind, id) < (${ts}::timestamptz, ${kind}::text, ${Number(id)}::bigint)`;
  }

  const limit = opts.limit;
  const rows = await db.execute<{ kind: ActivityEntry["kind"]; at: Date; id: number; payload: Record<string, unknown> }>(sql`
    with adds as (
      select cf.collection_id, cf.feed_id, cf.added_at,
             case when cf.added_at - lag(cf.added_at) over (partition by cf.collection_id order by cf.added_at, cf.feed_id) < ${BURST}::interval
                  then 0 else 1 end as brk
      from collection_feeds cf
      join collections col on col.id = cf.collection_id
      where col.user_id = ${u.id} and col.parent_id is not null and ${showCollections} ${colVisible}
    ), bursts as (
      select adds.*, sum(brk) over (partition by collection_id order by added_at, feed_id rows between unbounded preceding and current row) as grp
      from adds
    ), ranked as (
      select bursts.*, row_number() over (partition by collection_id, grp order by added_at, feed_id) as rn
      from bursts
    ), entries as (
      select 'feeds'::text as kind, max(r.added_at) as at, r.collection_id as id,
             jsonb_build_object(
               'collection', jsonb_build_object('name', col.name, 'slug', col.slug, 'visibility', col.visibility),
               'count', count(*)::int,
               'feeds', coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'title', coalesce(f.title, f.url), 'hasIcon', ${ICON("f.id")})
                                           order by r.added_at, r.feed_id) filter (where r.rn <= ${NAMED}), '[]'::jsonb)
             ) as payload
      from ranked r
      join collections col on col.id = r.collection_id
      join feeds f on f.id = r.feed_id
      group by r.collection_id, r.grp, col.name, col.slug, col.visibility

      union all
      -- Copied collections say so, and name the source: the copy graph is the
      -- one discovery signal thicket already has.
      select 'collection'::text, col.created_at, col.id,
             jsonb_build_object('name', col.name, 'slug', col.slug, 'visibility', col.visibility,
               'copiedFrom', (select jsonb_build_object('handle', su.handle, 'name', src.name, 'slug', src.slug)
                              from collections src join users su on su.id = src.user_id
                              where src.id = col.copied_from_id and su.profile_visibility = 'public' and src.visibility = 'public'))
      from collections col
      where col.user_id = ${u.id} and col.parent_id is not null and ${showCollections} ${colVisible}

      union all
      select 'bookmark'::text, b.saved_at, b.id,
             jsonb_build_object('url', b.url, 'title', b.title, 'siteTitle', b.site_title, 'feedId', b.feed_id, 'hasIcon', ${ICON("b.feed_id")})
      from bookmarks b
      where b.user_id = ${u.id} and ${showBookmarks}

      union all
      select 'note'::text, n.created_at, n.id,
             jsonb_build_object('body', n.body, 'itemId', n.item_id, 'url', i.url, 'title', i.title,
                                'siteTitle', f.title, 'feedId', i.feed_id, 'hasIcon', ${ICON("i.feed_id")})
      from notes n
      join items i on i.id = n.item_id
      join feeds f on f.id = i.feed_id
      where n.user_id = ${u.id} and ${showNotes}
    )
    select kind, at, id, payload from entries
    ${cursor}
    order by at desc, kind desc, id desc
    limit ${limit + 1}
  `);

  const all = rows.rows;
  const page = all.slice(0, limit).map((r) => ({ kind: r.kind, at: new Date(r.at).toISOString(), id: Number(r.id), payload: r.payload }));
  const last = all.length > limit ? page[page.length - 1] : null;
  return { entries: page, nextCursor: last ? `${last.at}|${last.kind}|${last.id}` : null };
}
