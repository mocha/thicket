/**
 * Notes on posts: the SQL fragments every listing shares, so the river, a
 * single feed, a public collection and the My Notes page all show the same
 * thing for the same viewer.
 *
 * Visibility of someone else's note is decided entirely at read time:
 *   the author's profile is public and they share notes (show_notes), and
 *   the viewer's notes_from admits the author: 'everyone', or 'following'
 *   and the viewer follows them. 'none' shows nothing. Signed-out viewers
 *   see no one's notes (they have no setting and no follows).
 */
import { sql } from "drizzle-orm";

/** Two pages of a Word document, roughly. Enough for a margin note, not an essay. */
export const NOTE_MAX = 2000;
/** Others' notes shown per post. More than this and the post is a comment thread, which this is not. */
export const NOTES_PER_ITEM = 8;

const noteJson = sql`jsonb_build_object('id', n.id, 'body', n.body, 'createdAt', n.created_at, 'updatedAt', n.updated_at)`;

/** Columns to add to any select over items `i`: the viewer's own note, and the notes of others they can see. */
export const noteColumns = (viewerId: number) => sql`
  (select ${noteJson} from notes n where n.user_id = ${viewerId} and n.item_id = i.id) as "myNote",
  coalesce((
    select json_agg(x.note order by x.created_at desc) from (
      select ${noteJson} || jsonb_build_object('author', jsonb_build_object('handle', u.handle, 'displayName', u.display_name)) as note, n.created_at
      from notes n
      join users u on u.id = n.user_id
      join users v on v.id = ${viewerId}
      where n.item_id = i.id and n.user_id <> ${viewerId}
        and u.profile_visibility = 'public' and u.show_notes
        and (v.notes_from = 'everyone'
             or (v.notes_from = 'following' and exists(select 1 from user_follows uf where uf.follower_id = v.id and uf.followee_id = n.user_id)))
      order by n.created_at desc limit ${NOTES_PER_ITEM}
    ) x
  ), '[]'::json) as notes
`;
