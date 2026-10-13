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

export const admin = new Hono();

async function requireAdmin(c: Parameters<typeof currentUser>[0]) {
  const user = currentUser(c);
  const [row] = await db.select({ isAdmin: schema.users.isAdmin }).from(schema.users).where(eq(schema.users.id, user.id));
  if (!row?.isAdmin) throw new HTTPException(403, { res: Response.json({ error: "admins only" }, { status: 403 }) });
  return user;
}

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

admin.get("/users", async (c) => {
  await requireAdmin(c);
  const rows = await db.execute(sql`
    select u.id, u.handle, u.display_name as "displayName", u.is_admin as "isAdmin", u.profile_visibility as "profileVisibility",
           u.created_at as "createdAt", (select ua.updated_at from user_avatars ua where ua.user_id = u.id) as "avatarUpdatedAt",
           (select max(s.last_seen_at) from sessions s where s.user_id = u.id) as "lastSeenAt",
           (select count(distinct cf.feed_id)::int from collection_feeds cf join collections col on col.id = cf.collection_id where col.user_id = u.id) as following,
           (select count(*)::int from collections col where col.user_id = u.id and col.parent_id is not null) as collections,
           (select count(*)::int from bookmarks b where b.user_id = u.id) as bookmarks,
           (select i.created_by from invites i where i.used_by = u.id limit 1) as "invitedById"
    from users u order by u.created_at
  `);
  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
  const byId = new Map(rows.rows.map((r: any) => [Number(r.id), r.handle]));
  return c.json({ users: rows.rows.map((r: any) => ({ ...r, id: Number(r.id), createdAt: iso(r.createdAt), lastSeenAt: iso(r.lastSeenAt), invitedBy: r.invitedById ? byId.get(Number(r.invitedById)) ?? null : null, invitedById: undefined })) });
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

/** How far back "failed N of M checks" looks: two weeks, or less if the fetch log is pruned sooner. */
export const FAILURE_WINDOW_DAYS = RETAIN_FETCH_LOG_DAYS > 0 ? Math.min(14, RETAIN_FETCH_LOG_DAYS) : 14;
/** Failed checks in a row before a feed counts as broken rather than having a bad day: with backoff, at least most of a day of failing. */
export const BROKEN_AFTER = 5;

/**
 * The admin feed list (issue #103). Each filter is a condition on the feed
 * row; "all" is no condition. The counts beside the filters come from the
 * same conditions, so a filter's count is always the length of its list.
 */
export const ADMIN_FEED_FILTERS = ["all", "failing", "broken", "unfollowed", "unfetched"] as const;
const FILTER_SQL: Record<(typeof ADMIN_FEED_FILTERS)[number], SQL> = {
  all: sql`true`,
  failing: sql`f.consecutive_failures > 0`,
  broken: sql`f.consecutive_failures >= ${BROKEN_AFTER}`,
  unfollowed: sql`f.follower_count = 0`,
  unfetched: sql`f.last_fetched_at is null`,
};
/** Every order reads a column on the feed row, so sorting the whole index is cheap; ties go to the most-followed. */
export const ADMIN_FEED_SORTS = ["followers", "posts", "added", "failures", "lastPost", "checked", "title"] as const;
const SORT_SQL: Record<(typeof ADMIN_FEED_SORTS)[number], SQL> = {
  followers: sql`f.follower_count`,
  posts: sql`f.item_count`,
  added: sql`f.created_at`,
  failures: sql`f.consecutive_failures`,
  lastPost: sql`f.last_item_at`,
  checked: sql`f.last_fetched_at`,
  title: sql`lower(coalesce(f.title, f.url))`,
};
const filterFrom = oneOf(ADMIN_FEED_FILTERS, "all");
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
 * its health: posts, followers, when it was added, and how its checks have
 * gone, both the current run of failures and the failures among its checks
 * over the last two weeks (from the fetch log). Who added a feed is not
 * recorded anywhere, on purpose.
 */
admin.get("/feeds", async (c) => {
  await requireAdmin(c);
  const filter = filterFrom(c.req.query("filter"));
  const sort = sortFrom(c.req.query("sort"));
  // Title reads A to Z; every other order starts with the biggest or newest.
  const dir = c.req.query("dir") === "asc" || c.req.query("dir") === "desc" ? c.req.query("dir")! : sort === "title" ? "asc" : "desc";
  const per = Math.min(500, Math.max(1, Math.trunc(Number(c.req.query("per"))) || 200));
  const page = Math.max(1, Math.trunc(Number(c.req.query("page"))) || 1);
  const search = feedSearch(c.req.query("q") ?? "");
  const matched = search ?? sql`true`;

  const [counts] = (await db.execute<Record<(typeof ADMIN_FEED_FILTERS)[number], number>>(sql`
    select count(*)::int as "all",
           count(*) filter (where ${FILTER_SQL.failing})::int as failing,
           count(*) filter (where ${FILTER_SQL.broken})::int as broken,
           count(*) filter (where ${FILTER_SQL.unfollowed})::int as unfollowed,
           count(*) filter (where ${FILTER_SQL.unfetched})::int as unfetched
    from feeds f where ${matched}`)).rows;

  // The page's ids are picked first, so the fetch log is read for those rows only, not the whole index.
  const order = sql`${SORT_SQL[sort]} ${sql.raw(dir)} nulls last, f.follower_count desc, f.id`;
  const rows = await db.execute(sql`
    with pick as (
      select f.id, row_number() over (order by ${order}) as n
      from feeds f where ${matched} and ${FILTER_SQL[filter]}
      order by n limit ${per} offset ${(page - 1) * per}
    )
    select f.id, f.url, f.site_url as "siteUrl", f.title, f.kind, ${feedSlugSql} as slug,
           exists(select 1 from feed_icons fi where fi.feed_id = f.id and not fi.generic) as "hasIcon",
           f.item_count as "itemCount", f.follower_count as "followerCount", f.posts_30d as "posts30d",
           f.created_at as "createdAt", f.last_fetched_at as "lastFetchedAt", f.last_item_at as "lastItemAt",
           f.consecutive_failures as "consecutiveFailures", f.last_status as "lastStatus", f.last_error as "lastError",
           f.requires_subscription as "requiresSubscription",
           h.checks, h.failures
    from pick join feeds f on f.id = pick.id
    left join lateral (
      select count(*)::int as checks, count(*) filter (where l.error is not null)::int as failures
      from fetch_log l where l.feed_id = f.id and l.at > now() - make_interval(days => ${FAILURE_WINDOW_DAYS})
    ) h on true
    order by pick.n`);
  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
  return c.json({
    feeds: rows.rows.map((r: any) => ({ ...r, id: Number(r.id), createdAt: iso(r.createdAt), lastFetchedAt: iso(r.lastFetchedAt), lastItemAt: iso(r.lastItemAt) })),
    total: counts[filter], counts, page, per, filter, sort, dir, windowDays: FAILURE_WINDOW_DAYS, brokenAfter: BROKEN_AFTER,
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
const PATCH_ERROR = "requiresSubscription (boolean) or title (string or null) is required";

/**
 * Facts about a feed that hold for everyone, set by an admin: whether its
 * posts are behind a paywall (issue #216), which shows as "Requires
 * subscription" beside the feed's address, and its title. Fetching only fills
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
  const { requiresSubscription, title } = body as { requiresSubscription?: unknown; title?: unknown };
  if (requiresSubscription === undefined && title === undefined) return c.json({ error: PATCH_ERROR }, 400);
  if (requiresSubscription !== undefined && typeof requiresSubscription !== "boolean") return c.json({ error: PATCH_ERROR }, 400);
  if (title !== undefined && title !== null && typeof title !== "string") return c.json({ error: PATCH_ERROR }, 400);

  const set: Partial<typeof schema.feeds.$inferInsert> = {};
  if (typeof requiresSubscription === "boolean") set.requiresSubscription = requiresSubscription;
  if (title !== undefined) {
    const trimmed = typeof title === "string" ? title.trim().slice(0, FEED_TITLE_MAX) : "";
    set.title = trimmed || null;
    if (!trimmed) Object.assign(set, { etag: null, lastModified: null, nextFetchAt: new Date() });
    set.updatedAt = new Date();
  }
  const [row] = await db.update(schema.feeds).set(set).where(eq(schema.feeds.id, id))
    .returning({ id: schema.feeds.id, requiresSubscription: schema.feeds.requiresSubscription, title: schema.feeds.title });
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
 * Returns the current handle for the admin to edit. The account is checked
 * when saving, so loading this setting doesn't need to enumerate accounts.
 */
admin.get("/starter", async (c) => {
  const handle = ((await getSetting<string>("starter_account")) ?? "").trim().toLowerCase();
  return c.json({ handle: handle || null });
});

admin.put("/starter", async (c) => {
  const body = await c.req.json<{ handle?: unknown }>().catch(() => ({}) as { handle?: unknown });
  const handle = typeof body.handle === "string" ? body.handle.trim().toLowerCase().replace(/^@/, "") : "";
  if (handle) {
    const [u] = (await db.execute<{ id: number }>(sql`select id from users where handle = ${handle}`)).rows;
    if (!u) return c.json({ error: "No account with that handle." }, 404);
  }
  await setSetting("starter_account", handle);
  return c.json({ handle: handle || null });
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
