/**
 * Notes on posts: the SQL fragments every listing shares, so the river, a
 * single feed, a public collection and the Bookmarks pages all show the same
 * thing for the same viewer.
 *
 * A note is part of a bookmark (bookmarks.note; issue #84). It shows under
 * every post with the bookmark's address, or under the post itself when the
 * bookmark was saved from a post with no link of its own. So the same story in
 * two feeds carries the note in both.
 *
 * Visibility of someone else's note is decided entirely at read time:
 *   the author's profile is public and their notes_visibility admits this
 *   viewer ('public', or 'friends' and the author follows them), and the
 *   viewer's own notes_from admits the author: 'everyone', or 'following'
 *   and the viewer follows them. 'none' shows nothing.
 *
 *   The two follow tests run in opposite directions on purpose: the author
 *   chooses their audience by following, the reader chooses their sources by
 *   following. Neither implies the other.
 *
 * On a person's own pages (their public collections, their bookmarks) the
 * page owner's notes skip the reader's half of the test: you came to read
 * them, so only the owner's sharing setting counts. That is how signed-out
 * visitors see notes at all: an owner who shares with Anyone is read on their
 * own pages by anyone. Everywhere else signed-out viewers see no one's notes,
 * having no setting and no follows. The owner's note sorts first.
 */
import { sql, type SQL } from "drizzle-orm";
import { allowsSql } from "./visibility.js";
import { feedSlugSql } from "./slug.js";

/** Two pages of a Word document, roughly. Enough for a margin note, not an essay. */
export const NOTE_MAX = 2000;
/** Others' notes shown per post. More than this and the post is a comment thread, which this is not. */
export const NOTES_PER_ITEM = 8;

/** Bookmark `b`'s note, in the shape the web app calls a Note. Its id is the bookmark's. */
export const noteJson = (b = "n") =>
  sql.raw(`jsonb_build_object('id', ${b}.id, 'body', ${b}.note, 'createdAt', ${b}.note_created_at, 'updatedAt', ${b}.note_updated_at)`);

/**
 * Does bookmark `b` belong to the post with this address and id? The address
 * decides, so one bookmark covers the story in every feed that carries it; the
 * id covers a post with no link, which is saved under its page here.
 */
export const matchesPost = (b: string, url: SQL, id: SQL): SQL =>
  sql`(${sql.raw(b)}.url = ${url} or (${url} is null and ${sql.raw(b)}.item_id = ${id}))`;

/** The address a bookmark of post `i` (joined to its feed `f`) is saved under. */
export const postAddressSql = sql`coalesce(i.url, '/feeds/' || f.id || '/' || ${feedSlugSql} || '/' || i.id)`;

/** The viewer's bookmark of post `i`, as its id, or null. */
export const myBookmarkIdSql = (viewerId: number) =>
  sql`(select bm.id from bookmarks bm where bm.user_id = ${viewerId} and ${matchesPost("bm", sql`i.url`, sql`i.id`)} limit 1)`;

/**
 * Other people's notes on one post, as a json array: the page owner's first
 * (if this is someone's page), then newest first. The viewer's own is left out;
 * it is shown on its own.
 */
export function othersNotesSql(viewerId: number, url: SQL, id: SQL, pageOwnerId: number | null = null): SQL {
  const owner = pageOwnerId ?? -1;
  return sql`coalesce((
    select json_agg(x.note order by x.is_owner desc, x.created_at desc) from (
      select ${noteJson()} || jsonb_build_object('author', jsonb_build_object('handle', u.handle, 'displayName', u.display_name)) as note,
             n.note_created_at as created_at, n.user_id = ${owner} as is_owner
      from bookmarks n
      join users u on u.id = n.user_id
      left join users v on v.id = ${viewerId}
      where n.note is not null and ${matchesPost("n", url, id)} and n.user_id <> ${viewerId}
        and u.profile_visibility = 'public' and ${allowsSql("u.notes_visibility", "u.id", viewerId > 0 ? viewerId : null)}
        and (n.user_id = ${owner}
             or v.notes_from = 'everyone'
             or (v.notes_from = 'following' and exists(select 1 from user_follows uf where uf.follower_id = v.id and uf.followee_id = n.user_id)))
      order by n.user_id = ${owner} desc, n.note_created_at desc limit ${NOTES_PER_ITEM}
    ) x
  ), '[]'::json)`;
}

/**
 * Columns to add to any select over items `i`: the viewer's own note, and the
 * notes of others they can see. `viewerId` is -1 when signed out. `pageOwnerId`
 * is the person whose page this is, when it is someone's page.
 */
export const noteColumns = (viewerId: number, pageOwnerId: number | null = null) => sql`
  (select ${noteJson()} from bookmarks n where n.user_id = ${viewerId} and n.note is not null and ${matchesPost("n", sql`i.url`, sql`i.id`)} limit 1) as "myNote",
  ${othersNotesSql(viewerId, sql`i.url`, sql`i.id`, pageOwnerId)} as notes
`;
