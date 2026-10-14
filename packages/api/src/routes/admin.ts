/**
 * Instance administration. The first account is the admin. Sign-up policy,
 * instance name, invite codes, and the user list: promote or demote admins,
 * hand someone a temporary password (there is no email to reset through),
 * remove an account. Everything here is a plain setting, no restart.
 */
import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { and, desc, eq, gt, sql, type SQL } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import { currentUser, destroyAllSessions, hashPassword } from "../lib/auth.js";
import { createInvite, getSetting, listInvites, publicStatus, revokeInvite, setSetting, type SignupPolicy } from "../lib/instance.js";
import { RETAIN_FETCH_LOG_DAYS, SIGNUPS_DEFAULT } from "../lib/config.js";
import { reconcile, recountWindows } from "../lib/counts.js";
import { feedSlugSql } from "../lib/slug.js";
import { oneOf } from "../lib/one-of.js";
import { discover, type Discovery } from "../feeds/discover.js";
import { explainAddFailure } from "../feeds/explain.js";
import { isHttpUrl, normalizeFeedUrl } from "../feeds/normalize.js";
import { existingFeedId } from "../feeds/twins.js";
import { mergeFeeds } from "../feeds/merge.js";
import { refreshFeed } from "../feeds/refresh.js";
import { featuredCollections } from "./explore.js";
import { likeFor } from "../lib/like.js";

export const admin = new Hono();

async function requireAdmin(c: Parameters<typeof currentUser>[0]) {
  const user = currentUser(c);
  const [row] = await db.select({ isAdmin: schema.users.isAdmin }).from(schema.users).where(eq(schema.users.id, user.id));
  if (!row?.isAdmin) throw new HTTPException(403, { res: Response.json({ error: "admins only" }, { status: 403 }) });
  return user;
}

/** Every route here is for admins. Checked once for the whole router, so a new route can't forget it; handlers that need who's asking still call requireAdmin. */
admin.use("*", async (c, next) => {
  await requireAdmin(c);
  await next();
});

admin.get("/settings", async (c) => {
  await requireAdmin(c);
  const status = await publicStatus();
  return c.json({ ...status, signupsStored: (await getSetting<SignupPolicy>("signups")) ?? null, signupsDefault: SIGNUPS_DEFAULT });
});

admin.patch("/settings", async (c) => {
  await requireAdmin(c);
  type Body = { signups?: SignupPolicy; name?: string; visitorLimit?: boolean };
  const body = await c.req.json<Body>().catch(() => ({} as Body));
  if (body.signups) {
    if (!["open", "invite", "closed"].includes(body.signups)) return c.json({ error: "signups must be open, invite, or closed" }, 400);
    await setSetting("signups", body.signups);
  }
  if (typeof body.name === "string") await setSetting("name", body.name.trim().slice(0, 60) || null);
  // true holds visitors without an account to their newest VISITOR_CAP of anything; false shows them everything.
  if (typeof body.visitorLimit === "boolean") await setSetting("visitorLimit", body.visitorLimit);
  return c.json(await publicStatus());
});

admin.get("/invites", async (c) => {
  await requireAdmin(c);
  return c.json({ invites: await listInvites() });
});

admin.post("/invites", async (c) => {
  const me = await requireAdmin(c);
  const body = await c.req.json<{ note?: string }>().catch(() => ({} as { note?: string }));
  return c.json(await createInvite(me.id, body.note?.slice(0, 120)), 201);
});

// ---- users ------------------------------------------------------------------

const USERS_DEFAULT_LIMIT = 20;
const USERS_MAX_LIMIT = 100;
const CURSOR_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z)_(\d{1,15})$/;

/** Search text as typed: trimmed, a leading "@" dropped. Empty means no filter. */
export function normalizeSearch(q: string | undefined): string {
  return (q ?? "").trim().replace(/^@/, "").trim();
}

/** Page size from the query string: default 20, clamped to 1..100. */
export function parseLimit(raw: string | undefined): number {
  const n = Math.floor(Number(raw));
  if (raw === undefined || raw.trim() === "" || !Number.isFinite(n)) return USERS_DEFAULT_LIMIT;
  return Math.min(USERS_MAX_LIMIT, Math.max(1, n));
}

/** A cursor is "<createdAt ISO, UTC>_<id>". Returns null when it is not one. */
export function parseCursor(raw: string): { createdAt: string; id: number } | null {
  const m = CURSOR_RE.exec(raw);
  if (!m) return null;
  // The date must be a real one: JavaScript rolls February 31 into March, but the database refuses it.
  const d = new Date(m[1]);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 19) !== m[1].slice(0, 19)) return null;
  return { createdAt: m[1], id: Number(m[2]) };
}

admin.get("/users", async (c) => {
  await requireAdmin(c);
  const q = normalizeSearch(c.req.query("q"));
  const limit = parseLimit(c.req.query("limit"));
  const beforeRaw = c.req.query("before");
  const cursor = beforeRaw ? parseCursor(beforeRaw) : null;
  if (beforeRaw && !cursor) return c.json({ error: "before is not a valid cursor; use the next value from the previous page" }, 400);

  const pattern = likeFor(q);
  const search = q ? sql`and (u.handle ilike ${pattern} escape '\\' or u.display_name ilike ${pattern} escape '\\')` : sql``;
  const after = cursor ? sql`and (u.created_at, u.id) < (${cursor.createdAt}::timestamptz, ${cursor.id})` : sql``;

  const page = db.execute(sql`
    select u.id, u.handle, u.display_name as "displayName", u.is_admin as "isAdmin", u.profile_visibility as "profileVisibility",
           u.created_at as "createdAt",
           to_char(u.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "cursorAt",
           (select ua.updated_at from user_avatars ua where ua.user_id = u.id) as "avatarUpdatedAt",
           (select max(s.last_seen_at) from sessions s where s.user_id = u.id) as "lastSeenAt",
           (select count(distinct cf.feed_id)::int from collection_feeds cf join collections col on col.id = cf.collection_id where col.user_id = u.id) as following,
           (select count(*)::int from collections col where col.user_id = u.id and col.parent_id is not null) as collections,
           (select count(*)::int from bookmarks b where b.user_id = u.id) as bookmarks,
           (select inviter.handle from invites i join users inviter on inviter.id = i.created_by where i.used_by = u.id limit 1) as "invitedBy"
    from users u
    where true ${search} ${after}
    order by u.created_at desc, u.id desc
    limit ${limit + 1}
  `);
  // The totals don't change while paging, so only the first page counts them, alongside the page itself.
  const [rows, counted] = await Promise.all([
    page,
    cursor ? null : db.execute<{ total: number; matched: number }>(sql`
      select count(*)::int as total,
             (count(*) filter (where true ${search}))::int as matched
      from users u
    `),
  ]);
  const counts = counted?.rows[0];

  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
  const shown = rows.rows.slice(0, limit) as any[];
  const last = shown[shown.length - 1];
  const next = rows.rows.length > limit && last ? `${last.cursorAt}_${Number(last.id)}` : null;
  const users = shown.map((r) => ({ ...r, id: Number(r.id), createdAt: iso(r.createdAt), lastSeenAt: iso(r.lastSeenAt), avatarUpdatedAt: r.avatarUpdatedAt ? iso(r.avatarUpdatedAt) : null, invitedBy: r.invitedBy ?? null, cursorAt: undefined }));
  return c.json({ users, next, ...(counts ? { total: counts.total, matched: counts.matched } : {}) });
});

async function adminCount() {
  const [{ n }] = (await db.execute<{ n: number }>(sql`select count(*)::int as n from users where is_admin`)).rows;
  return n;
}

/** Promote or demote. You cannot demote yourself, and the last admin cannot be demoted. */
admin.patch("/users/:id", async (c) => {
  const me = await requireAdmin(c);
  const id = Number(c.req.param("id"));
  const body = await c.req.json<{ isAdmin?: boolean }>().catch(() => ({} as { isAdmin?: boolean }));
  if (typeof body.isAdmin !== "boolean") return c.json({ error: "isAdmin (boolean) is required" }, 400);
  if (id === me.id && !body.isAdmin) return c.json({ error: "You can’t remove your own admin role. Ask another admin." }, 400);
  if (!body.isAdmin && (await adminCount()) <= 1) return c.json({ error: "That’s the last admin." }, 400);
  const [row] = await db.update(schema.users).set({ isAdmin: body.isAdmin }).where(eq(schema.users.id, id)).returning({ id: schema.users.id, handle: schema.users.handle, isAdmin: schema.users.isAdmin });
  return row ? c.json(row) : c.json({ error: "not found" }, 404);
});

/** A one-time temporary password, shown once to the admin to pass along. Signs the user out everywhere. */
admin.post("/users/:id/password", async (c) => {
  await requireAdmin(c);
  const id = Number(c.req.param("id"));
  const [u] = await db.select({ id: schema.users.id, handle: schema.users.handle }).from(schema.users).where(eq(schema.users.id, id));
  if (!u) return c.json({ error: "not found" }, 404);
  const password = randomBytes(9).toString("base64url").replace(/[-_]/g, "x").slice(0, 12);
  await db.update(schema.users).set({ passwordHash: await hashPassword(password) }).where(eq(schema.users.id, id));
  await destroyAllSessions(id);
  return c.json({ handle: u.handle, password });
});

/** Removes the account and everything it owned (collections, bookmarks, sessions cascade). The shared feed index is untouched. */
admin.delete("/users/:id", async (c) => {
  const me = await requireAdmin(c);
  const id = Number(c.req.param("id"));
  if (id === me.id) return c.json({ error: "You can’t delete your own account from here." }, 400);
  const rows = await db.delete(schema.users).where(eq(schema.users.id, id)).returning({ id: schema.users.id });
  return rows.length ? c.body(null, 204) : c.json({ error: "not found" }, 404);
});

// ---- feeds --------------------------------------------------------------------

/** A feed id from the path, or null for anything that can't be one (so it 404s before reaching the database). */
function feedIdParam(raw: string): number | null {
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** How far back a feed's check history goes: two weeks, or less if the fetch log is pruned sooner. */
export const FAILURE_WINDOW_DAYS = RETAIN_FETCH_LOG_DAYS > 0 ? Math.min(14, RETAIN_FETCH_LOG_DAYS) : 14;
/** Failed checks in a row before a feed counts as broken rather than having a bad day: with backoff, at least most of a day of failing. */
export const BROKEN_AFTER = 5;

/** The admin feed list's orders (issue #103). Each reads a column on the feed row, so sorting the whole index is cheap; ties go to the most-followed. */
export const ADMIN_FEED_SORTS = ["followers", "posts", "failures", "lastPost", "title"] as const;
const SORT_SQL: Record<(typeof ADMIN_FEED_SORTS)[number], SQL> = {
  followers: sql`f.follower_count`,
  posts: sql`f.posts_30d`,
  // Grouped as the list's Health column words them (broken, failing, OK); within a group the most-followed come first, below.
  failures: sql`case when f.consecutive_failures >= ${BROKEN_AFTER} then 2 when f.consecutive_failures > 0 then 1 else 0 end`,
  lastPost: sql`f.last_item_at`,
  title: sql`lower(coalesce(f.title, f.url))`,
};
const sortFrom = oneOf(ADMIN_FEED_SORTS, "followers");

/**
 * What a search for a feed is matched against. A pasted address loses its
 * scheme, "www." and trailing slash, so it finds the feed whichever way it was
 * written; a bare number also finds the feed with that id.
 */
export function feedSearch(q: string): SQL | null {
  const term = q.trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/+$/, "");
  if (!term) return null;
  const like = `%${term.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  const byId = /^\d{1,15}$/.test(term) ? sql` or f.id = ${Number(term)}` : sql``;
  return sql`(f.title ilike ${like} or f.url ilike ${like} or f.site_url ilike ${like}${byId})`;
}

/**
 * Every feed in the index, a page at a time, with what an admin needs to judge
 * its health at a glance: followers, posts in the last 30 days, its last post,
 * and its run of failed checks, which the list words as OK, Failing or Broken.
 * The detail (errors, the check history) is on the feed's Manage page. Who
 * added a feed is not recorded anywhere, on purpose.
 */
admin.get("/feeds", async (c) => {
  await requireAdmin(c);
  const sort = sortFrom(c.req.query("sort"));
  // Title reads A to Z; every other order starts with the biggest or newest.
  const dir = c.req.query("dir") === "asc" || c.req.query("dir") === "desc" ? c.req.query("dir")! : sort === "title" ? "asc" : "desc";
  const per = Math.min(500, Math.max(1, Math.trunc(Number(c.req.query("per"))) || 200));
  const page = Math.max(1, Math.trunc(Number(c.req.query("page"))) || 1);
  const matched = feedSearch(c.req.query("q") ?? "") ?? sql`true`;

  const [{ total }] = (await db.execute<{ total: number }>(sql`select count(*)::int as total from feeds f where ${matched}`)).rows;
  const order = sql`${SORT_SQL[sort]} ${sql.raw(dir)} nulls last, f.follower_count desc, f.id`;
  const rows = await db.execute(sql`
    select f.id, f.url, f.site_url as "siteUrl", f.title, ${feedSlugSql} as slug,
           exists(select 1 from feed_icons fi where fi.feed_id = f.id and not fi.generic) as "hasIcon",
           f.follower_count as "followerCount", f.posts_30d as "posts30d",
           f.last_fetched_at as "lastFetchedAt", f.last_item_at as "lastItemAt", f.consecutive_failures as "consecutiveFailures"
    from feeds f where ${matched}
    order by ${order} limit ${per} offset ${(page - 1) * per}`);
  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
  return c.json({
    feeds: rows.rows.map((r: any) => ({ ...r, id: Number(r.id), lastFetchedAt: iso(r.lastFetchedAt), lastItemAt: iso(r.lastItemAt) })),
    total, page, per, sort, dir, brokenAfter: BROKEN_AFTER,
  });
});

/** One feed's recent checks, newest first, from the fetch log: when, the answer, how long it took, new posts, and the error if it failed. */
admin.get("/feeds/:id/fetches", async (c) => {
  await requireAdmin(c);
  const id = feedIdParam(c.req.param("id"));
  if (id === null) return c.json({ error: "not found" }, 404);
  const rows = await db.select({
    at: schema.fetchLog.at, status: schema.fetchLog.status, durationMs: schema.fetchLog.durationMs,
    itemsNew: schema.fetchLog.itemsNew, error: schema.fetchLog.error,
  }).from(schema.fetchLog)
    .where(and(eq(schema.fetchLog.feedId, id), gt(schema.fetchLog.at, sql`now() - make_interval(days => ${FAILURE_WINDOW_DAYS})`)))
    .orderBy(desc(schema.fetchLog.at)).limit(100);
  return c.json({ fetches: rows.map((r) => ({ ...r, at: r.at.toISOString() })), windowDays: FAILURE_WINDOW_DAYS });
});

/**
 * Moderation: what removing a feed from the instance would take with it. Feeds
 * are shared, so this is everyone's loss, not one person's; the numbers are
 * shown before the button is pressed.
 */
admin.get("/feeds/:id/impact", async (c) => {
  await requireAdmin(c);
  const id = Number(c.req.param("id"));
  const [row] = (await db.execute<{ title: string | null; url: string; posts: number; followers: number; collections: number; bookmarks: number }>(sql`
    select f.title, f.url,
           (select count(*)::int from items i where i.feed_id = f.id) as posts,
           (select count(distinct col.user_id)::int from collection_feeds cf join collections col on col.id = cf.collection_id where cf.feed_id = f.id) as followers,
           (select count(*)::int from collection_feeds cf where cf.feed_id = f.id) as collections,
           (select count(*)::int from bookmarks b where b.feed_id = f.id) as bookmarks
    from feeds f where f.id = ${id}`)).rows;
  return row ? c.json(row) : c.json({ error: "not found" }, 404);
});

/** The longest title an admin can give a feed. */
export const FEED_TITLE_MAX = 200;
const PATCH_ERROR = "title (string or null) is required";
/** How many of a feed's post terms the diagnostics list. More is noise on one screen. */
const FEED_TERMS_SHOWN = 500;

/**
 * The categories a feed ships, for its diagnostics (issue #189): what the
 * feed says about itself on its last fetch, and every term its posts were
 * filed under, counted across all the posts thicket holds. Raw material,
 * shown to admins only while we learn what feeds actually send.
 */
admin.get("/feeds/:id/categories", async (c) => {
  await requireAdmin(c);
  const id = Number(c.req.param("id"));
  if (!Number.isSafeInteger(id) || id <= 0) return c.json({ error: "not found" }, 404);
  const [feed] = (await db.execute<{ declared: string[] | null; posts: number; tagged: number }>(sql`
    select f.categories as declared,
           (select count(*)::int from items i where i.feed_id = f.id) as posts,
           (select count(*)::int from items i where i.feed_id = f.id and i.categories is not null) as tagged
    from feeds f where f.id = ${id}`)).rows;
  if (!feed) return c.json({ error: "not found" }, 404);
  const terms = feed.tagged ? (await db.execute<{ term: string; posts: number }>(sql`
    select t.term, count(*)::int as posts
    from items i cross join lateral unnest(i.categories) as t(term)
    where i.feed_id = ${id} and i.categories is not null
    group by t.term order by posts desc, t.term limit ${FEED_TERMS_SHOWN}`)).rows : [];
  return c.json({ declared: feed.declared ?? [], posts: feed.posts, tagged: feed.tagged, terms });
});

/** The categories one post was filed under, for the reader's admin line. */
admin.get("/items/:id/categories", async (c) => {
  await requireAdmin(c);
  const id = Number(c.req.param("id"));
  if (!Number.isSafeInteger(id) || id <= 0) return c.json({ error: "not found" }, 404);
  const [row] = (await db.execute<{ categories: string[] | null }>(sql`select categories from items where id = ${id}`)).rows;
  return row ? c.json({ categories: row.categories ?? [] }) : c.json({ error: "not found" }, 404);
});

/**
 * A feed's title for everyone, set by an admin. Fetching only fills
 * a title in when there is none, so one set here stays. Clearing it hands the
 * title back to the feed: the next check is made unconditional and soon, so the
 * feed's own title comes back with it.
 */
admin.patch("/feeds/:id", async (c) => {
  await requireAdmin(c);
  const id = feedIdParam(c.req.param("id"));
  if (id === null) return c.json({ error: "not found" }, 404);
  const body = await c.req.json<unknown>().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return c.json({ error: PATCH_ERROR }, 400);
  const { title } = body as { title?: unknown };
  if (title === undefined || (title !== null && typeof title !== "string")) return c.json({ error: PATCH_ERROR }, 400);

  const trimmed = typeof title === "string" ? title.trim().slice(0, FEED_TITLE_MAX) : "";
  const set: Partial<typeof schema.feeds.$inferInsert> = { title: trimmed || null, updatedAt: new Date() };
  if (!trimmed) Object.assign(set, { etag: null, lastModified: null, nextFetchAt: new Date() });
  const [row] = await db.update(schema.feeds).set(set).where(eq(schema.feeds.id, id))
    .returning({ id: schema.feeds.id, title: schema.feeds.title });
  return row ? c.json(row) : c.json({ error: "not found" }, 404);
});

const isUniqueViolation = (e: unknown) => {
  const err = e as { code?: string; cause?: { code?: string } } | null;
  return err?.code === "23505" || err?.cause?.code === "23505";
};

/**
 * Point a feed at a new address: a site that moved its feed, or a dead address
 * with a working one beside it. The new address is looked up the way adding a
 * feed does, so a site's page works as well as its feed, and the answer can be
 * "this page has several feeds, pick one". If thicket already has a feed at the
 * new address, this one is folded into it (feeds/merge.ts): its followers,
 * their settings, and bookmarks all move, so nobody has to follow anything
 * again. Otherwise the feed keeps its id, takes the new address, starts its
 * health over, and is fetched straight away.
 */
admin.post("/feeds/:id/address", async (c) => {
  const me = await requireAdmin(c);
  const id = feedIdParam(c.req.param("id"));
  if (id === null) return c.json({ error: "not found" }, 404);
  const body = await c.req.json<{ url?: unknown } | null>().catch(() => null);
  if (typeof body?.url !== "string" || !body.url.trim()) return c.json({ error: "Enter the feed’s new address." }, 400);
  let normalized: string;
  try {
    normalized = normalizeFeedUrl(body.url);
  } catch {
    return c.json({ error: "That doesn’t look like a web address. Check it and try again." }, 400);
  }
  if (!isHttpUrl(normalized)) return c.json({ error: "Use an address that starts with http or https." }, 400);
  const [feed] = await db.select({ id: schema.feeds.id, url: schema.feeds.url }).from(schema.feeds).where(eq(schema.feeds.id, id));
  if (!feed) return c.json({ error: "not found" }, 404);

  let d: Discovery;
  try {
    d = await discover(normalized);
  } catch (err) {
    console.error(`[admin] new address for feed ${id}, ${new URL(normalized).hostname}:`, err);
    return c.json({ error: explainAddFailure(err, normalized) }, 424);
  }
  if (d.status === "candidates") return c.json({ status: "choose" as const, candidates: d.candidates });
  if (d.status === "none") return c.json({ error: "There’s no feed at that address." }, 404);
  if (d.url === feed.url) return c.json({ error: "That’s already this feed’s address." }, 400);

  const other = await existingFeedId(d.url);
  if (other !== null && other !== id) {
    await mergeFeeds(id, other, `@${me.handle} moved it to ${d.url}`);
    console.log(`[admin] @${me.handle} moved feed ${id} ${feed.url} to ${d.url}, already feed ${other}`);
    return c.json({ status: "merged" as const, feedId: other });
  }
  try {
    await db.update(schema.feeds).set({
      url: d.url, etag: null, lastModified: null, consecutiveFailures: 0, lastStatus: null, lastError: null, nextFetchAt: new Date(), updatedAt: new Date(),
    }).where(eq(schema.feeds.id, id));
  } catch (e) {
    if (isUniqueViolation(e)) return c.json({ error: "Another feed took that address a moment ago. Try again to fold this one into it." }, 409);
    throw e;
  }
  console.log(`[admin] @${me.handle} moved feed ${id} from ${feed.url} to ${d.url}`);
  // Fetched now, so the page shows whether the new address works. A fetch that lands on another feed's address folds this one into it.
  const r = await refreshFeed(id);
  return c.json({ status: "moved" as const, feedId: r.feedId, url: d.url, fetch: { status: r.status, itemsNew: r.itemsNew, error: r.error } });
});

/**
 * Remove a feed from the instance. Cascades: its posts, its place in every
 * collection, everyone's settings and blocks on it, its icon and fetch log.
 * Bookmarks, and the notes on them, keep their copy of the post and lose the
 * link to it (the column is nullable for exactly this). Logged, because it is the
 * one admin action that deletes other people's things.
 */
admin.delete("/feeds/:id", async (c) => {
  const me = await requireAdmin(c);
  const id = Number(c.req.param("id"));
  const rows = await db.delete(schema.feeds).where(eq(schema.feeds.id, id)).returning({ id: schema.feeds.id, url: schema.feeds.url });
  if (!rows.length) return c.json({ error: "not found" }, 404);
  console.log(`[admin] @${me.handle} removed feed ${id} ${rows[0].url}`);
  return c.body(null, 204);
});

admin.delete("/invites/:code", async (c) => {
  await requireAdmin(c);
  const ok = await revokeInvite(c.req.param("code"));
  return ok ? c.body(null, 204) : c.json({ error: "not found or already used" }, 404);
});

/**
 * Starter packs: which account's public collections a newcomer is offered.
 * Returns the current handle for the admin to edit, and the collections a
 * brand-new account is offered as a result. The account is checked when
 * saving, so loading this setting doesn't need to enumerate accounts.
 */
admin.get("/starter", async (c) => {
  await requireAdmin(c);
  const handle = ((await getSetting<string>("starter_account")) ?? "").trim().toLowerCase();
  const featured = await featuredCollections(-1);
  return c.json({ handle: handle || null, from: featured.from, offered: featured.collections });
});

admin.put("/starter", async (c) => {
  await requireAdmin(c);
  const body = await c.req.json<{ handle?: unknown }>().catch(() => ({}) as { handle?: unknown });
  const handle = typeof body.handle === "string" ? body.handle.trim().toLowerCase().replace(/^@/, "") : "";
  if (handle) {
    const [u] = (await db.execute<{ shared: boolean }>(sql`select (profile_visibility = 'public' and collections_visibility = 'public') as shared from users where handle = ${handle}`)).rows;
    if (!u) return c.json({ error: "No account with that handle." }, 404);
    // New people only ever see public collections, so a private account would silently fall back to the default set.
    if (!u.shared) return c.json({ error: "That account’s profile or collections aren’t public, so new people couldn’t see them." }, 400);
  }
  await setSetting("starter_account", handle);
  const featured = await featuredCollections(-1);
  return c.json({ handle: handle || null, from: featured.from, offered: featured.collections });
});

// ---- maintenance --------------------------------------------------------------

/**
 * Recount the stored sort counts now (lib/counts.ts), for when one looks wrong
 * and the nightly pass is hours away. The answer says how many were off, which
 * is the number worth knowing: anything but zero means a trigger missed a write.
 */
admin.post("/recount", async (c) => {
  await requireAdmin(c);
  const drift = await reconcile();
  const windows = await recountWindows();
  return c.json({ drift, windowsChanged: windows });
});
