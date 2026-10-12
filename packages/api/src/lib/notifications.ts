/**
 * Notifications (issue #184): what happened, lately, that concerns me.
 *
 *   follow    someone started following me
 *   bookmark  someone I follow bookmarked a post
 *   note      someone I follow wrote a note on a post
 *   mention   someone @mentioned me in a note (lib/mentions.ts)
 *   collection  someone I follow made a collection (issue #274)
 *   invite    someone signed up with an invite I made
 *   reply     someone noted a post I bookmarked or noted
 *
 * **Mine to tune** (issue #274): each kind has a switch on my account
 * (Prefs), and mentions take "from everyone / people I follow / no one". The
 * switches are applied before supersession, so turning one kind off never
 * hides another kind I kept: a note that mentions me still shows as a note
 * when I've turned mentions off.
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
 *   - Only what they did after I followed them: following someone is not a
 *     request for their history. (A mention needs no follow, so it has no such
 *     line.)
 *   - A note supersedes the bookmark it lives on (issue #84): a noted post is
 *     one act, shown once, as the note, when I may read notes; as the bookmark
 *     otherwise.
 *   - A mention shows when their profile is public and their notes are shared
 *     with me, whether or not I follow them: being named is the point.
 *   - A note on a post I saved shows under the same test as a mention: it's
 *     one I could read on their profile. Only notes written after I saved the
 *     post.
 *   - One note is shown once, as the strongest kind I've left on: a mention,
 *     then a note on my post, then the plain "noted" line.
 *   - A new collection by someone I follow shows when their profile is
 *     public, their collections are shared with me, and that collection is
 *     too: what their profile would list. Only collections made after I
 *     followed them, and never the hidden root every account has.
 *   - A sign-up with my invite always shows, but names the new person only
 *     when their profile is public, the same rule as a follow.
 *   - Nothing I did myself.
 */
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { mentionsHandleSql } from "./mentions.js";
import { matchesPost, noteJson } from "./notes.js";
import { allows, allowsSql, type Audience, type ShareLevel } from "./visibility.js";

/** How far back the list goes. */
export const WINDOW_DAYS = 30;
/** The most the list holds and the bubble counts; past it the bubble says "100+". */
export const CAP = 100;

/** How far back `since` may reach when a script asks for a range. The list still holds at most CAP. */
export const MAX_DAYS = 365;
export const KINDS = ["follow", "bookmark", "note", "mention", "collection", "invite", "reply"] as const;
export type Kind = (typeof KINDS)[number];

/** Whose mentions notify me. The same values as "Notes from other people", a separate setting. */
export type MentionsFrom = "none" | "following" | "everyone";

/** Which kinds I get (users.notify_*, users.mentions_from). */
export type Prefs = { [K in Exclude<Kind, "mention">]: boolean } & { mentionsFrom: MentionsFrom };

/** What a new account starts with, the same as the database defaults. */
export const DEFAULT_PREFS: Prefs = { follow: true, bookmark: true, note: true, collection: true, invite: true, reply: false, mentionsFrom: "everyone" };

/**
 * The part of the list a caller asked for: after `since`, up to and including
 * `until`, of these kinds (null for all of them).
 */
export type Range = { since: string; until: string; kinds: Kind[] | null };

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * A point in time as a script would write it: `24h` or `7d` back from now, a
 * day (`2026-10-01`, its start, or its end when it closes a range), or a full
 * ISO time. Null when it is none of those.
 */
function when(raw: string, now: number, endOfDay: boolean): number | null {
  const rel = /^(\d{1,4})([hd])$/.exec(raw);
  if (rel) return now - Number(rel[1]) * (rel[2] === "h" ? HOUR : DAY);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const t = Date.parse(`${raw}T00:00:00Z`);
    return Number.isNaN(t) ? null : endOfDay ? t + DAY : t;
  }
  if (!/^\d{4}-\d{2}-\d{2}T/.test(raw)) return null;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? null : t;
}

/**
 * `?since=&until=&kind=` on GET /api/notifications, read into a Range, or the
 * reason it can't be. Without any of them it is the page's own list: the last
 * WINDOW_DAYS, every kind. A future `until` is now. Pure.
 */
export function parseRange(q: { since?: string; until?: string; kind?: string }, now: number): Range | { error: string } {
  const since = q.since ? when(q.since, now, false) : now - WINDOW_DAYS * DAY;
  if (since === null) return { error: "since: use a time like 24h, 7d, 2026-10-01 or 2026-10-01T09:00:00Z" };
  const until = q.until ? when(q.until, now, true) : now;
  if (until === null) return { error: "until: use a time like 24h, 7d, 2026-10-01 or 2026-10-01T09:00:00Z" };
  if (since < now - MAX_DAYS * DAY) return { error: `since: notifications go back at most ${MAX_DAYS} days` };
  if (since >= until) return { error: "since must be before until" };
  let kinds: Kind[] | null = null;
  if (q.kind) {
    const asked = q.kind.split(",").map((k) => k.trim()).filter(Boolean);
    const bad = asked.filter((k) => !(KINDS as readonly string[]).includes(k));
    if (bad.length) return { error: `kind: ${bad.join(", ")} is not one of ${KINDS.join(", ")}` };
    kinds = asked as Kind[];
  }
  return { since: new Date(since).toISOString(), until: new Date(Math.min(until, now)).toISOString(), kinds };
}

export type Person = { id: number; handle: string; displayName: string | null; avatarUpdatedAt: string | null };

/** The author of a bookmark or note, with what decides whether I may see it. */
type Author = Person & {
  profileVisibility: "public" | "private";
  bookmarksVisibility: ShareLevel;
  notesVisibility: ShareLevel;
  activityVisibility: ShareLevel;
  collectionsVisibility: ShareLevel;
  /** They follow me, so "friends" includes me. */
  followsMe: boolean;
  /** I follow them, for mentions "from people I follow". */
  iFollow: boolean;
};

/** Someone following me, and whether I follow them back (for Follow back on the row). */
export type FollowRow = { at: string; person: Person & { profileVisibility: "public" | "private"; bio?: string | null }; following?: boolean };

/** A post, as the one-line notifications name it. */
export type PostRef = { url: string; title: string | null; siteTitle: string | null; feedId: number | null; hasIcon: boolean };

/** A bookmark by someone I follow, noted or not, and when I started following them. */
/** `bookmark`: the whole bookmark, note included, so the notification can show it as a Bookmark card. */
export type SaveRow = { id: number; author: Author; post: PostRef; savedAt: string; noteCreatedAt: string | null; followedAt: string; bookmark?: Record<string, unknown> | null };

/**
 * A note that mentions me. `bookmark` is the whole bookmark in the shape a
 * profile's bookmarks list sends, note included, so the page can show the post
 * with the note on it.
 */
export type MentionRow = { id: number; author: Author; at: string; bookmark: Record<string, unknown> };

/** A note on a post I saved, in the same shape as a mention, timed by when it was written. */
export type ReplyRow = MentionRow;

/** A collection, as a notification names it. */
export type CollectionRef = { name: string; slug: string; description: string | null; feedCount: number };

/** A collection by someone I follow, its own audience, and when I started following them. */
export type CollectionRow = { at: string; author: Author; visibility: ShareLevel; followedAt: string; collection: CollectionRef };

/** Someone who signed up with an invite I made. */
export type InviteRow = FollowRow;

export type Candidates = { follows: FollowRow[]; saves: SaveRow[]; mentions: MentionRow[]; replies: ReplyRow[]; collections: CollectionRow[]; invites: InviteRow[] };

type Who = Omit<Person, "id">;
const who = (p: Person): Who => ({ handle: p.handle, displayName: p.displayName, avatarUpdatedAt: p.avatarUpdatedAt });

export type Notification =
  /** `following`: I already follow them, so the row needs no Follow back. */
  | { kind: "follow"; key: string; at: string; isNew: boolean; person: Who & { bio: string | null }; following: boolean }
  /** Shown whole, as the Bookmark card; `post` names it in one line for a script. */
  | { kind: "bookmark" | "note"; key: string; at: string; isNew: boolean; person: Who; post: PostRef; bookmark: Record<string, unknown> }
  | { kind: "mention" | "reply"; key: string; at: string; isNew: boolean; person: Who; bookmark: Record<string, unknown> }
  | { kind: "collection"; key: string; at: string; isNew: boolean; person: Who; collection: CollectionRef }
  /** `person` is null when their profile is private: someone joined, unnamed. */
  | { kind: "invite"; key: string; at: string; isNew: boolean; person: (Who & { bio: string | null }) | null; following: boolean };

/** A notification before it is judged new or not. */
type Draft = Notification extends infer N ? (N extends unknown ? Omit<N, "isNew"> : never) : never;

const audience = (a: Author): Audience => ({ isMe: false, isFriend: a.followsMe });

/**
 * Turn candidates into the list I see, newest first: my switches applied,
 * then visibility and supersession, my own acts left out, and each marked new
 * or not against `seenAt`. Only what happened after `since` and up to
 * `until`, of `kinds` when given (a script's narrowing, applied last, so a
 * mention stays a mention when asking for notes). `truncated` says the list
 * stopped at CAP with more in range: ask again with an earlier `until`. Pure.
 */
export function assemble(meId: number, c: Candidates, opts: { seenAt: string; since: string; until?: string; kinds?: Kind[] | null; prefs?: Prefs }): { items: Notification[]; count: number; more: boolean; truncated: boolean } {
  const p = opts.prefs ?? DEFAULT_PREFS;
  const since = Date.parse(opts.since);
  const seen = Date.parse(opts.seenAt);
  const until = opts.until ? Date.parse(opts.until) : Infinity;
  const inWindow = (at: string | null) => !!at && Date.parse(at) > since && Date.parse(at) <= until;
  /** Their notes are ones I could read on their profile. */
  const readable = (a: Author) => a.profileVisibility === "public" && allows(a.notesVisibility, audience(a));
  const out: Draft[] = [];

  if (p.follow) for (const f of c.follows) {
    if (f.person.id === meId || f.person.profileVisibility !== "public" || !inWindow(f.at)) continue;
    out.push({ kind: "follow", key: `follow:${f.person.handle}`, at: f.at, person: { ...who(f.person), bio: f.person.bio ?? null }, following: !!f.following });
  }

  if (p.invite) for (const i of c.invites) {
    if (i.person.id === meId || !inWindow(i.at)) continue;
    const named = i.person.profileVisibility === "public";
    out.push({ kind: "invite", key: named ? `invite:${i.person.handle}` : `invite:${i.at}`, at: i.at, person: named ? { ...who(i.person), bio: i.person.bio ?? null } : null, following: named && !!i.following });
  }

  if (p.collection) for (const k of c.collections) {
    const a = k.author;
    if (a.id === meId || a.profileVisibility !== "public" || !allows(a.collectionsVisibility, audience(a)) || !allows(k.visibility, audience(a))) continue;
    if (!inWindow(k.at) || Date.parse(k.at) <= Date.parse(k.followedAt)) continue;
    out.push({ kind: "collection", key: `collection:${a.handle}/${k.collection.slug}`, at: k.at, person: who(a), collection: k.collection });
  }

  // One note, shown once, as the strongest kind I've left on.
  const shown = new Set<number>();
  const mentionsOn = (a: Author) => p.mentionsFrom === "everyone" || (p.mentionsFrom === "following" && a.iFollow);
  for (const m of c.mentions) {
    const a = m.author;
    if (a.id === meId || !mentionsOn(a) || !readable(a) || !inWindow(m.at)) continue;
    shown.add(m.id);
    out.push({ kind: "mention", key: `mention:${m.id}`, at: m.at, person: who(a), bookmark: m.bookmark });
  }
  if (p.reply) for (const r of c.replies) {
    const a = r.author;
    if (a.id === meId || shown.has(r.id) || !readable(a) || !inWindow(r.at)) continue;
    shown.add(r.id);
    out.push({ kind: "reply", key: `reply:${r.id}`, at: r.at, person: who(a), bookmark: r.bookmark });
  }

  for (const s of c.saves) {
    const a = s.author;
    const followed = Date.parse(s.followedAt);
    const fresh = (at: string | null) => inWindow(at) && Date.parse(at!) > followed;
    if (a.id === meId || shown.has(s.id) || a.profileVisibility !== "public" || !allows(a.activityVisibility, audience(a))) continue;
    if (p.note && s.noteCreatedAt && allows(a.notesVisibility, audience(a))) {
      if (fresh(s.noteCreatedAt)) out.push({ kind: "note", key: `note:${s.id}`, at: s.noteCreatedAt, person: who(a), post: s.post, bookmark: s.bookmark ?? {} });
      // A noted post is one act: the note stands for it even outside the range.
      continue;
    }
    if (p.bookmark && allows(a.bookmarksVisibility, audience(a)) && fresh(s.savedAt)) {
      out.push({ kind: "bookmark", key: `bookmark:${s.id}`, at: s.savedAt, person: who(a), post: s.post, bookmark: s.bookmark ?? {} });
    }
  }

  const kept = opts.kinds ? out.filter((n) => opts.kinds!.includes(n.kind)) : out;
  kept.sort((x, y) => Date.parse(y.at) - Date.parse(x.at) || (x.key < y.key ? -1 : 1));
  const items = kept.slice(0, CAP).map((n) => ({ ...n, isNew: Date.parse(n.at) > seen }) as Notification);
  const fresh = kept.filter((n) => Date.parse(n.at) > seen).length;
  return { items, count: Math.min(fresh, CAP), more: fresh > CAP, truncated: kept.length > CAP };
}

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const ICON = sql`exists(select 1 from feed_icons fi where fi.feed_id = b.feed_id and not fi.generic)`;
/** The author's columns, from users `u` and their picture `ua`, plus whether they follow me. */
const authorCols = (meId: number) => sql`
  u.id as "authorId", u.handle, u.display_name as "displayName", ua.updated_at as "avatarUpdatedAt",
  u.profile_visibility as "profileVisibility", u.bookmarks_visibility as "bookmarksVisibility",
  u.notes_visibility as "notesVisibility", u.activity_visibility as "activityVisibility",
  u.collections_visibility as "collectionsVisibility",
  exists(select 1 from user_follows fm where fm.follower_id = u.id and fm.followee_id = ${meId}) as "followsMe",
  exists(select 1 from user_follows fi where fi.follower_id = ${meId} and fi.followee_id = u.id) as "iFollow"`;

type AuthorDbRow = {
  authorId: number; handle: string; displayName: string | null; avatarUpdatedAt: Date | null;
  profileVisibility: "public" | "private"; bookmarksVisibility: ShareLevel; notesVisibility: ShareLevel; activityVisibility: ShareLevel;
  collectionsVisibility: ShareLevel; followsMe: boolean; iFollow: boolean;
};
const authorOf = (r: AuthorDbRow): Author => ({
  id: Number(r.authorId), handle: r.handle, displayName: r.displayName, avatarUpdatedAt: iso(r.avatarUpdatedAt),
  profileVisibility: r.profileVisibility, bookmarksVisibility: r.bookmarksVisibility, notesVisibility: r.notesVisibility,
  activityVisibility: r.activityVisibility, collectionsVisibility: r.collectionsVisibility, followsMe: r.followsMe, iFollow: r.iFollow,
});

/** Author `u`'s notes are ones I could read on their profile. The same test as `assemble`, so the caps below only count real candidates. */
const readableSql = (meId: number) => sql`u.profile_visibility = 'public' and ${allowsSql("u.notes_visibility", "u.id", meId)}`;

/** Bookmark `b` whole, in the shape a profile's bookmarks list sends, note included. */
const bookmarkJson = (meId: number) => sql`jsonb_build_object(
  'id', b.id, 'itemId', b.item_id, 'feedId', b.feed_id, 'url', b.url, 'title', b.title, 'summary', b.summary,
  'imageUrl', b.image_url, 'siteTitle', b.site_title, 'author', b.author, 'publishedAt', b.published_at,
  'savedAt', b.saved_at, 'activeAt', greatest(b.saved_at, b.note_updated_at), 'note', case when b.note is null then null else ${noteJson("b")} end,
  'hasIcon', ${ICON},
  'myBookmarkId', (select mb.id from bookmarks mb where mb.user_id = ${meId} and mb.url = b.url limit 1),
  'linkUrl', i.link_url, 'linkLabel', i.link_label
)`;

type PersonDbRow = { at: Date; id: number; handle: string; displayName: string | null; avatarUpdatedAt: Date | null; profileVisibility: "public" | "private"; following: boolean; bio: string | null };
const personRow = (r: PersonDbRow) => ({ at: iso(r.at)!, person: { id: Number(r.id), handle: r.handle, displayName: r.displayName, avatarUpdatedAt: iso(r.avatarUpdatedAt), profileVisibility: r.profileVisibility, bio: r.bio }, following: r.following });

/**
 * Everything that could be a notification for me in the window, straight from
 * the tables, for the kinds I have on. Each read is bounded by an index that
 * starts from me: my followers, the bookmarks and collections of the people I
 * follow, my invites, notes on posts I saved, and notes written or edited
 * lately (for mentions). Visibility is checked here as well as in `assemble`,
 * so hidden rows never take a place under a cap.
 */
export async function candidatesFor(me: { id: number; handle: string }, since: string, until: string, prefs: Prefs = DEFAULT_PREFS): Promise<Candidates> {
  const none = Promise.resolve({ rows: [] as never[] });
  const inRange = (col: string) => sql`${sql.raw(col)} > ${since}::timestamptz and ${sql.raw(col)} <= ${until}::timestamptz`;

  const followsQ = prefs.follow ? db.execute<PersonDbRow>(sql`
    select uf.created_at as at, fu.id, fu.handle, fu.display_name as "displayName", fu.bio, ua.updated_at as "avatarUpdatedAt", fu.profile_visibility as "profileVisibility",
           exists(select 1 from user_follows fb where fb.follower_id = ${me.id} and fb.followee_id = fu.id) as following
    from user_follows uf join users fu on fu.id = uf.follower_id
    left join user_avatars ua on ua.user_id = fu.id
    where uf.followee_id = ${me.id} and ${inRange("uf.created_at")} and fu.profile_visibility = 'public'
    order by uf.created_at desc limit ${CAP + 1}
  `) : none;

  // Named or not, every sign-up counts, so the profile isn't filtered here.
  const invitesQ = prefs.invite ? db.execute<PersonDbRow>(sql`
    select i.used_at as at, nu.id, nu.handle, nu.display_name as "displayName", nu.bio, ua.updated_at as "avatarUpdatedAt", nu.profile_visibility as "profileVisibility",
           exists(select 1 from user_follows fb where fb.follower_id = ${me.id} and fb.followee_id = nu.id) as following
    from invites i join users nu on nu.id = i.used_by
    left join user_avatars ua on ua.user_id = nu.id
    where i.created_by = ${me.id} and ${inRange("i.used_at")}
    order by i.used_at desc limit ${CAP + 1}
  `) : none;

  // A note written today on a post saved last year counts too, by when the note was written.
  // Only rows that will become a notification are fetched, so the cap counts real ones: the same
  // rule as `assemble`. A note I may read, with notes enabled, is the note (or nothing, when it's
  // outside the range or from before I followed them); otherwise the bookmark, when bookmarks are
  // enabled and shared with me. A disabled kind never takes a place.
  const noteOk = prefs.note ? sql`(b.note is not null and ${allowsSql("u.notes_visibility", "u.id", me.id)})` : sql`false`;
  const savesQ = prefs.bookmark || prefs.note ? db.execute<AuthorDbRow & { id: number; url: string; title: string | null; siteTitle: string | null; feedId: number | null; hasIcon: boolean; savedAt: Date; noteCreatedAt: Date | null; followedAt: Date; bookmark: Record<string, unknown> | null }>(sql`
    select b.id, b.url, b.title, b.site_title as "siteTitle", b.feed_id as "feedId", ${ICON} as "hasIcon",
           b.saved_at as "savedAt", case when b.note is null then null else b.note_created_at end as "noteCreatedAt",
           mine.created_at as "followedAt",
           ${bookmarkJson(me.id)} as bookmark,
           ${authorCols(me.id)}
    from user_follows mine
    join bookmarks b on b.user_id = mine.followee_id
    join users u on u.id = b.user_id
    left join user_avatars ua on ua.user_id = u.id
    left join items i on i.id = b.item_id
    where mine.follower_id = ${me.id} and b.user_id <> ${me.id}
      and (${inRange("b.saved_at")} or ${inRange("b.note_created_at")})
      and u.profile_visibility = 'public' and ${allowsSql("u.activity_visibility", "u.id", me.id)}
      and case when ${noteOk}
        then ${inRange("b.note_created_at")} and b.note_created_at > mine.created_at
        else ${prefs.bookmark ? sql`${allowsSql("u.bookmarks_visibility", "u.id", me.id)} and ${inRange("b.saved_at")} and b.saved_at > mine.created_at` : sql`false`}
      end
    order by case when ${noteOk} then b.note_created_at else b.saved_at end desc limit ${CAP * 3}
  `) : none;

  // The hidden root every account has is never one (parent_id is null).
  const collectionsQ = prefs.collection ? db.execute<AuthorDbRow & { at: Date; visibility: ShareLevel; followedAt: Date; name: string; slug: string; description: string | null; feedCount: number }>(sql`
    select col.created_at as at, col.visibility, mine.created_at as "followedAt",
           col.name, col.slug, col.description, col.feed_count as "feedCount",
           ${authorCols(me.id)}
    from user_follows mine
    join collections col on col.user_id = mine.followee_id and col.parent_id is not null
    join users u on u.id = col.user_id
    left join user_avatars ua on ua.user_id = u.id
    where mine.follower_id = ${me.id} and ${inRange("col.created_at")} and col.created_at > mine.created_at
      and u.profile_visibility = 'public' and ${allowsSql("u.collections_visibility", "u.id", me.id)} and ${allowsSql("col.visibility", "u.id", me.id)}
    order by col.created_at desc limit ${CAP + 1}
  `) : none;

  // Timed by the last edit, so a mention added to a note after it was first written still arrives.
  const mentionsQ = prefs.mentionsFrom !== "none" ? db.execute<AuthorDbRow & { id: number; at: Date; bookmark: Record<string, unknown> }>(sql`
    select b.id, b.note_updated_at as at, ${authorCols(me.id)}, ${bookmarkJson(me.id)} as bookmark
    from bookmarks b
    join users u on u.id = b.user_id
    left join user_avatars ua on ua.user_id = u.id
    left join items i on i.id = b.item_id
    where b.note is not null and ${inRange("b.note_updated_at")} and b.user_id <> ${me.id}
      and ${mentionsHandleSql(sql`b.note`, me.handle)} and ${readableSql(me.id)}
      ${prefs.mentionsFrom === "following" ? sql`and exists(select 1 from user_follows fi where fi.follower_id = ${me.id} and fi.followee_id = u.id)` : sql``}
    order by b.note_updated_at desc limit ${CAP + 1}
  `) : none;

  // Starts from my own bookmarks, never from every note: a post's notes are found by its address,
  // and each note matches at most one of my bookmarks (one per address).
  // Only notes written after I saved the post, timed by when they were written.
  const repliesQ = prefs.reply ? db.execute<AuthorDbRow & { id: number; at: Date; bookmark: Record<string, unknown> }>(sql`
    select b.id, b.note_created_at as at, ${authorCols(me.id)}, ${bookmarkJson(me.id)} as bookmark
    from bookmarks mine
    join bookmarks b on ${matchesPost("b", sql`mine.url`, sql`mine.item_id`)} and b.note is not null
    join users u on u.id = b.user_id
    left join user_avatars ua on ua.user_id = u.id
    left join items i on i.id = b.item_id
    where mine.user_id = ${me.id} and b.user_id <> ${me.id}
      and ${inRange("b.note_created_at")} and b.note_created_at > mine.saved_at and ${readableSql(me.id)}
    order by b.note_created_at desc limit ${CAP + 1}
  `) : none;

  // Independent reads, so they run side by side: the bubble asks for all of them too.
  const [follows, invites, saves, collections, mentions, replies] = await Promise.all([followsQ, invitesQ, savesQ, collectionsQ, mentionsQ, repliesQ]);

  return {
    follows: follows.rows.map(personRow),
    invites: invites.rows.map(personRow),
    saves: saves.rows.map((r) => ({
      id: Number(r.id), author: authorOf(r), savedAt: iso(r.savedAt)!, noteCreatedAt: iso(r.noteCreatedAt), followedAt: iso(r.followedAt)!, bookmark: r.bookmark,
      post: { url: r.url, title: r.title, siteTitle: r.siteTitle, feedId: r.feedId === null ? null : Number(r.feedId), hasIcon: r.hasIcon },
    })),
    collections: collections.rows.map((r) => ({
      at: iso(r.at)!, author: authorOf(r), visibility: r.visibility, followedAt: iso(r.followedAt)!,
      collection: { name: r.name, slug: r.slug, description: r.description, feedCount: Number(r.feedCount) },
    })),
    mentions: mentions.rows.map((r) => ({ id: Number(r.id), author: authorOf(r), at: iso(r.at)!, bookmark: r.bookmark })),
    replies: replies.rows.map((r) => ({ id: Number(r.id), author: authorOf(r), at: iso(r.at)!, bookmark: r.bookmark })),
  };
}

type PrefsDbRow = { follow: boolean; bookmark: boolean; note: boolean; collection: boolean; invite: boolean; reply: boolean; mentionsFrom: MentionsFrom };
const PREFS_COLS = sql`notify_follows as follow, notify_bookmarks as bookmark, notify_notes as note, notify_collections as collection,
  notify_invites as invite, notify_replies as reply, mentions_from as "mentionsFrom"`;
const prefsOf = (r: PrefsDbRow): Prefs => ({ follow: r.follow, bookmark: r.bookmark, note: r.note, collection: r.collection, invite: r.invite, reply: r.reply, mentionsFrom: r.mentionsFrom });

/**
 * My notifications, as of now: the list, how many are new, and the moment it
 * was read (what "seen" may move up to). The last WINDOW_DAYS of every kind,
 * or the `range` a caller asked for (parseRange).
 */
export async function notificationsFor(me: { id: number; handle: string }, range?: Range) {
  const [row] = (await db.execute<{ seenAt: Date; now: Date } & PrefsDbRow>(sql`
    select notifications_seen_at as "seenAt", now() as now, ${PREFS_COLS} from users where id = ${me.id}
  `)).rows;
  const prefs = prefsOf(row);
  const asOf = iso(row.now)!;
  const since = range?.since ?? new Date(Date.parse(asOf) - WINDOW_DAYS * DAY).toISOString();
  const until = range?.until ?? asOf;
  const seenAt = iso(row.seenAt)!;
  const c = await candidatesFor(me, since, until, prefs);
  return { ...assemble(me.id, c, { seenAt, since, until, kinds: range?.kinds, prefs }), seenAt, asOf, since, until };
}
