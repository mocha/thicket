/**
 * Notes on posts: the SQL fragments every listing shares, so the river, a
 * single feed, a public collection and the My Notes page all show the same
 * thing for the same viewer.
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
 * On a person's own pages (their public collections, their notes list) the
 * page owner's notes skip the reader's half of the test: you came to read
 * them, so only the owner's sharing setting counts. That is how signed-out
 * visitors see notes at all: an owner who shares with Anyone is read on their
 * own pages by anyone. Everywhere else signed-out viewers see no one's notes,
 * having no setting and no follows. The owner's note sorts first.
 */
import { sql } from "drizzle-orm";
import { allowsSql } from "./visibility.js";

/** Two pages of a Word document, roughly. Enough for a margin note, not an essay. */
export const NOTE_MAX = 2000;
/** Others' notes shown per post. More than this and the post is a comment thread, which this is not. */
export const NOTES_PER_ITEM = 8;

const noteJson = sql`jsonb_build_object('id', n.id, 'body', n.body, 'createdAt', n.created_at, 'updatedAt', n.updated_at)`;

/**
 * Columns to add to any select over items `i`: the viewer's own note, and the
 * notes of others they can see. `viewerId` is -1 when signed out. `pageOwnerId`
 * is the person whose page this is, when it is someone's page.
 */
export const noteColumns = (viewerId: number, pageOwnerId: number | null = null) => {
  const owner = pageOwnerId ?? -1;
  return sql`
  (select ${noteJson} from notes n where n.user_id = ${viewerId} and n.item_id = i.id) as "myNote",
  coalesce((
    select json_agg(x.note order by x.is_owner desc, x.created_at desc) from (
      select ${noteJson} || jsonb_build_object('author', jsonb_build_object('handle', u.handle, 'displayName', u.display_name)) as note,
             n.created_at, n.user_id = ${owner} as is_owner
      from notes n
      join users u on u.id = n.user_id
      left join users v on v.id = ${viewerId}
      where n.item_id = i.id and n.user_id <> ${viewerId}
        and u.profile_visibility = 'public' and ${allowsSql("u.notes_visibility", "u.id", viewerId > 0 ? viewerId : null)}
        and (n.user_id = ${owner}
             or v.notes_from = 'everyone'
             or (v.notes_from = 'following' and exists(select 1 from user_follows uf where uf.follower_id = v.id and uf.followee_id = n.user_id)))
      order by n.user_id = ${owner} desc, n.created_at desc limit ${NOTES_PER_ITEM}
    ) x
  ), '[]'::json) as notes
`;
};
