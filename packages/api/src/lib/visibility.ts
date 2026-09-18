/**
 * Who can see what. Notes, bookmarks and collections each have an audience:
 *
 *   private  — only me
 *   friends  — me and **the people I follow**
 *   public   — anyone, signed in or not
 *
 * "friends" is deliberately the people I follow, not the people who follow me.
 * Following someone is how you choose to share with them; someone following me
 * gains nothing by doing it. That also means the audience is one I curated
 * rather than one that accumulated, which is the safer default for a set of
 * people who can read my notes.
 *
 * A collection can narrow further (collections.visibility), and that is the
 * only individual override in the product for now. It can never widen: a public
 * collection in a friends-only account is still friends-only.
 *
 * A feed document has no reader and so can carry only 'public' — see
 * docs/DECISIONS.md, "Every public page is also a feed".
 */
import { sql, type SQL } from "drizzle-orm";
import { db } from "../db/client.js";

export type ShareLevel = "private" | "friends" | "public";

export const isShareLevel = (v: unknown): v is ShareLevel => v === "private" || v === "friends" || v === "public";

/** Does this owner share with this viewer at all? True when the owner follows them. */
export async function isFriendOf(ownerId: number, viewerId: number | null | undefined): Promise<boolean> {
  if (!viewerId || viewerId === ownerId) return false;
  const r = await db.execute<{ yes: boolean }>(sql`select exists(select 1 from user_follows where follower_id = ${ownerId} and followee_id = ${viewerId}) as yes`);
  return r.rows[0]?.yes === true;
}

/** What one viewer can see of one owner, once the follow is known. */
export type Audience = { isMe: boolean; isFriend: boolean };

export const allows = (level: ShareLevel, who: Audience): boolean =>
  who.isMe || level === "public" || (level === "friends" && who.isFriend);

/**
 * The same test in SQL, for listings where the owner differs row by row (notes
 * under posts, say). `owner` and `level` are column references in the caller's
 * query. Signed-out viewers pass a null id and only ever match 'public'.
 */
export function allowsSql(level: string, owner: string, viewerId: number | null): SQL {
  const lvl = sql.raw(level);
  const own = sql.raw(owner);
  if (!viewerId) return sql`${lvl} = 'public'`;
  return sql`(${lvl} = 'public' or (${lvl} = 'friends' and exists(select 1 from user_follows sh where sh.follower_id = ${own} and sh.followee_id = ${viewerId})))`;
}

/**
 * The same test where every row belongs to one owner whose audience is already
 * known — a profile's own collections, say. No per-row follow lookup: the one
 * `audienceFor` did answers the whole listing.
 */
/** The same answer as a list, for a `visibility in (...)` on one owner's rows. */
export function allowedLevels(who: Audience): ShareLevel[] {
  if (who.isMe) return ["private", "friends", "public"];
  return who.isFriend ? ["friends", "public"] : ["public"];
}

export function allowedLevelsSql(level: string, who: Audience): SQL {
  const lvl = sql.raw(level);
  if (who.isMe) return sql`true`;
  if (who.isFriend) return sql`${lvl} in ('public', 'friends')`;
  return sql`${lvl} = 'public'`;
}
