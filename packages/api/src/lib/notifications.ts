/**
 * Notifications (issue #184): what happened, lately, that concerns me.
 *
 *   follow    someone started following me
 *   bookmark  someone I follow bookmarked a post
 *   note      someone I follow wrote a note on a post
 *   mention   someone @mentioned me in a note (lib/mentions.ts)
 *
 * **Derived, not stored**, like activity (lib/activity.ts): there is no
 * notifications table. Each one is read off the row it is about, so an
 * unfollow, an unsaved bookmark, a deleted note or a mention edited out simply
 * stops being a notification. Nothing has to be withdrawn and nothing remembers
 * what someone took back. The one thing kept is how far down the list I have
 * looked (users.notifications_seen_at): anything newer is new.
 *
 * **Bounded.** Only the last WINDOW_DAYS are looked at, and only CAP entries
 * are kept, so the cost follows the people I follow and the notes written
 * lately, never the size of the instance or the age of the account. The
 * bubble stops counting at CAP, the same as "what's new" (routes/marks.ts).
 *
 * **Never more than the profile would show.** The database supplies each
 * candidate with the facts that decide whether I may see it (the author's
 * sharing levels, whether they follow me) and the decision is made here, in
 * `assemble`, with the same `allows` test the profile uses. That keeps the
 * rules in one readable place and lets them be tested without a database:
 *
 *   - A follow names the follower only when their profile is public, the same
 *     rule as the Followers list (routes/profiles.ts): a private profile stays
 *     opaque. Nothing is said on an unfollow.
 *   - A bookmark or note by someone I follow shows when their profile is
 *     public and their recent activity, and that section (bookmarks or notes),
 *     are shared with me — what their Recent activity list would show me.
 *   - A note supersedes the bookmark it lives on (issue #84): a noted post is
 *     one act, shown once, as the note, when I may read notes; as the bookmark
 *     otherwise.
 *   - A mention shows when their profile is public and their notes are shared
 *     with me, whether or not I follow them: being named is the point. It
 *     supersedes the plain "noted" line for the same note.
 *   - Nothing I did myself.
 */
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { mentionsHandleSql } from "./mentions.js";
import { noteJson } from "./notes.js";
import { allows, type Audience, type ShareLevel } from "./visibility.js";

/** How far back the list goes. */
export const WINDOW_DAYS = 30;
/** The most the list holds and the bubble counts; past it the bubble says "100+". */
export const CAP = 100;

export type Person = { id: number; handle: string; displayName: string | null; avatarUpdatedAt: string | null };

/** The author of a bookmark or note, with what decides whether I may see it. */
type Author = Person & {
  profileVisibility: "public" | "private";
  bookmarksVisibility: ShareLevel;
  notesVisibility: ShareLevel;
  activityVisibility: ShareLevel;
  /** They follow me, so "friends" includes me. */
  followsMe: boolean;
};

/** Someone following me. */
export type FollowRow = { at: string; person: Person & { profileVisibility: "public" | "private" } };

/** A post, as the one-line notifications name it. */
export type PostRef = { url: string; title: string | null; siteTitle: string | null; feedId: number | null; hasIcon: boolean };

/** A bookmark by someone I follow, noted or not. */
export type SaveRow = { id: number; author: Author; post: PostRef; savedAt: string; noteCreatedAt: string | null };

/**
 * A note that mentions me. `bookmark` is the whole bookmark in the shape a
 * profile's bookmarks list sends, note included, so the page can show the post
 * with the note on it.
 */
export type MentionRow = { id: number; author: Author; at: string; bookmark: Record<string, unknown> };

export type Candidates = { follows: FollowRow[]; saves: SaveRow[]; mentions: MentionRow[] };

type Who = Omit<Person, "id">;
const who = (p: Person): Who => ({ handle: p.handle, displayName: p.displayName, avatarUpdatedAt: p.avatarUpdatedAt });

export type Notification =
  | { kind: "follow"; key: string; at: string; isNew: boolean; person: Who }
  | { kind: "bookmark" | "note"; key: string; at: string; isNew: boolean; person: Who; post: PostRef }
  | { kind: "mention"; key: string; at: string; isNew: boolean; person: Who; bookmark: Record<string, unknown> };

/** A notification before it is judged new or not. */
type Draft = Notification extends infer N ? (N extends unknown ? Omit<N, "isNew"> : never) : never;

const audience = (a: Author): Audience => ({ isMe: false, isFriend: a.followsMe });

/**
 * Turn candidates into the list I see, newest first: visibility applied,
 * supersession applied, my own acts left out, and each marked new or not
 * against `seenAt`. `since` is the start of the window. Pure.
 */
export function assemble(meId: number, c: Candidates, opts: { seenAt: string; since: string }): { items: Notification[]; count: number; more: boolean } {
  const since = Date.parse(opts.since);
  const seen = Date.parse(opts.seenAt);
  const inWindow = (at: string | null) => !!at && Date.parse(at) > since;
  const out: Draft[] = [];

  for (const f of c.follows) {
    if (f.person.id === meId || f.person.profileVisibility !== "public" || !inWindow(f.at)) continue;
    out.push({ kind: "follow", key: `follow:${f.person.handle}`, at: f.at, person: who(f.person) });
  }

  const mentioned = new Set<number>();
  for (const m of c.mentions) {
    const a = m.author;
    if (a.id === meId || a.profileVisibility !== "public" || !allows(a.notesVisibility, audience(a)) || !inWindow(m.at)) continue;
    mentioned.add(m.id);
    out.push({ kind: "mention", key: `mention:${m.id}`, at: m.at, person: who(a), bookmark: m.bookmark });
  }

  for (const s of c.saves) {
    const a = s.author;
    if (a.id === meId || a.profileVisibility !== "public" || !allows(a.activityVisibility, audience(a))) continue;
    const notes = allows(a.notesVisibility, audience(a));
    const marks = allows(a.bookmarksVisibility, audience(a));
    if (s.noteCreatedAt && notes) {
      // A note I was mentioned in is already here, in full.
      if (!mentioned.has(s.id) && inWindow(s.noteCreatedAt)) out.push({ kind: "note", key: `note:${s.id}`, at: s.noteCreatedAt, person: who(a), post: s.post });
    } else if (marks && inWindow(s.savedAt)) {
      out.push({ kind: "bookmark", key: `bookmark:${s.id}`, at: s.savedAt, person: who(a), post: s.post });
    }
  }

  out.sort((x, y) => Date.parse(y.at) - Date.parse(x.at) || (x.key < y.key ? -1 : 1));
  const items = out.slice(0, CAP).map((n) => ({ ...n, isNew: Date.parse(n.at) > seen }) as Notification);
  const fresh = out.filter((n) => Date.parse(n.at) > seen).length;
  return { items, count: Math.min(fresh, CAP), more: fresh > CAP };
}

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const ICON = sql`exists(select 1 from feed_icons fi where fi.feed_id = b.feed_id and not fi.generic)`;
/** The author's columns, from users `u` and their picture `ua`, plus whether they follow me. */
const authorCols = (meId: number) => sql`
  u.id as "authorId", u.handle, u.display_name as "displayName", ua.updated_at as "avatarUpdatedAt",
  u.profile_visibility as "profileVisibility", u.bookmarks_visibility as "bookmarksVisibility",
  u.notes_visibility as "notesVisibility", u.activity_visibility as "activityVisibility",
  exists(select 1 from user_follows fm where fm.follower_id = u.id and fm.followee_id = ${meId}) as "followsMe"`;

type AuthorDbRow = {
  authorId: number; handle: string; displayName: string | null; avatarUpdatedAt: Date | null;
  profileVisibility: "public" | "private"; bookmarksVisibility: ShareLevel; notesVisibility: ShareLevel; activityVisibility: ShareLevel; followsMe: boolean;
};
const authorOf = (r: AuthorDbRow): Author => ({
  id: Number(r.authorId), handle: r.handle, displayName: r.displayName, avatarUpdatedAt: iso(r.avatarUpdatedAt),
  profileVisibility: r.profileVisibility, bookmarksVisibility: r.bookmarksVisibility, notesVisibility: r.notesVisibility,
  activityVisibility: r.activityVisibility, followsMe: r.followsMe,
});

/**
 * Everything that could be a notification for me in the window, straight from
 * the tables. Three bounded reads: my followers by the followee index, the
 * bookmarks of the people I follow by (user, saved_at), and notes written or
 * edited lately by the partial index on note_updated_at.
 */
export async function candidatesFor(me: { id: number; handle: string }, since: string): Promise<Candidates> {
  const follows = await db.execute<{ at: Date; id: number; handle: string; displayName: string | null; avatarUpdatedAt: Date | null; profileVisibility: "public" | "private" }>(sql`
    select uf.created_at as at, fu.id, fu.handle, fu.display_name as "displayName", ua.updated_at as "avatarUpdatedAt", fu.profile_visibility as "profileVisibility"
    from user_follows uf join users fu on fu.id = uf.follower_id
    left join user_avatars ua on ua.user_id = fu.id
    where uf.followee_id = ${me.id} and uf.created_at > ${since}::timestamptz
    order by uf.created_at desc limit ${CAP}
  `);

  // A note written today on a post saved last year counts too, by when the note was written.
  const saves = await db.execute<AuthorDbRow & { id: number; url: string; title: string | null; siteTitle: string | null; feedId: number | null; hasIcon: boolean; savedAt: Date; noteCreatedAt: Date | null }>(sql`
    select b.id, b.url, b.title, b.site_title as "siteTitle", b.feed_id as "feedId", ${ICON} as "hasIcon",
           b.saved_at as "savedAt", case when b.note is null then null else b.note_created_at end as "noteCreatedAt",
           ${authorCols(me.id)}
    from user_follows mine
    join bookmarks b on b.user_id = mine.followee_id
    join users u on u.id = b.user_id
    left join user_avatars ua on ua.user_id = u.id
    where mine.follower_id = ${me.id} and b.user_id <> ${me.id}
      and (b.saved_at > ${since}::timestamptz or b.note_created_at > ${since}::timestamptz)
    order by greatest(b.saved_at, coalesce(b.note_created_at, b.saved_at)) desc limit ${CAP * 3}
  `);

  // Timed by the last edit, so a mention added to a note after it was first written still arrives.
  const mentions = await db.execute<AuthorDbRow & { id: number; at: Date; bookmark: Record<string, unknown> }>(sql`
    select b.id, b.note_updated_at as at, ${authorCols(me.id)},
           jsonb_build_object(
             'id', b.id, 'itemId', b.item_id, 'feedId', b.feed_id, 'url', b.url, 'title', b.title, 'summary', b.summary,
             'imageUrl', b.image_url, 'siteTitle', b.site_title, 'author', b.author, 'publishedAt', b.published_at,
             'savedAt', b.saved_at, 'activeAt', greatest(b.saved_at, b.note_updated_at), 'note', ${noteJson("b")},
             'hasIcon', ${ICON},
             'myBookmarkId', (select mb.id from bookmarks mb where mb.user_id = ${me.id} and mb.url = b.url limit 1),
             'linkUrl', i.link_url, 'linkLabel', i.link_label
           ) as bookmark
    from bookmarks b
    join users u on u.id = b.user_id
    left join user_avatars ua on ua.user_id = u.id
    left join items i on i.id = b.item_id
    where b.note is not null and b.note_updated_at > ${since}::timestamptz and b.user_id <> ${me.id}
      and ${mentionsHandleSql(sql`b.note`, me.handle)}
    order by b.note_updated_at desc limit ${CAP}
  `);

  return {
    follows: follows.rows.map((r) => ({ at: iso(r.at)!, person: { id: Number(r.id), handle: r.handle, displayName: r.displayName, avatarUpdatedAt: iso(r.avatarUpdatedAt), profileVisibility: r.profileVisibility } })),
    saves: saves.rows.map((r) => ({
      id: Number(r.id), author: authorOf(r), savedAt: iso(r.savedAt)!, noteCreatedAt: iso(r.noteCreatedAt),
      post: { url: r.url, title: r.title, siteTitle: r.siteTitle, feedId: r.feedId === null ? null : Number(r.feedId), hasIcon: r.hasIcon },
    })),
    mentions: mentions.rows.map((r) => ({ id: Number(r.id), author: authorOf(r), at: iso(r.at)!, bookmark: r.bookmark })),
  };
}

/** My notifications, as of now: the list, how many are new, and the moment it was read (what "seen" may move up to). */
export async function notificationsFor(me: { id: number; handle: string }) {
  const [row] = (await db.execute<{ seenAt: Date; now: Date }>(sql`
    select notifications_seen_at as "seenAt", now() as now from users where id = ${me.id}
  `)).rows;
  const asOf = iso(row.now)!;
  const since = new Date(Date.parse(asOf) - WINDOW_DAYS * 86_400_000).toISOString();
  const seenAt = iso(row.seenAt)!;
  const c = await candidatesFor(me, since);
  return { ...assemble(me.id, c, { seenAt, since }), seenAt, asOf };
}
