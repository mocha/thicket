/**
 * Instance administration. The first account is the admin. Sign-up policy,
 * instance name, invite codes, and the user list: promote or demote admins,
 * hand someone a temporary password (there is no email to reset through),
 * remove an account. Everything here is a plain setting, no restart.
 */
import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import { currentUser, destroyAllSessions, hashPassword } from "../lib/auth.js";
import { createInvite, getSetting, listInvites, publicStatus, revokeInvite, setSetting, type SignupPolicy } from "../lib/instance.js";
import { SIGNUPS_DEFAULT } from "../lib/config.js";
import { reconcile, recountWindows } from "../lib/counts.js";
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
  if (!m || Number.isNaN(Date.parse(m[1]))) return null;
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
 * Facts about a feed that hold for everyone, set by an admin. For now only
 * whether its posts are behind a paywall (issue #216), which shows as
 * "Requires subscription" beside the feed's address.
 */
admin.patch("/feeds/:id", async (c) => {
  await requireAdmin(c);
  const id = Number(c.req.param("id"));
  if (!Number.isSafeInteger(id) || id <= 0) return c.json({ error: "not found" }, 404);
  const body = await c.req.json<{ requiresSubscription?: boolean } | null>().catch(() => null);
  if (typeof body?.requiresSubscription !== "boolean") return c.json({ error: "requiresSubscription (boolean) is required" }, 400);
  const [row] = await db.update(schema.feeds).set({ requiresSubscription: body.requiresSubscription }).where(eq(schema.feeds.id, id))
    .returning({ id: schema.feeds.id, requiresSubscription: schema.feeds.requiresSubscription });
  return row ? c.json(row) : c.json({ error: "not found" }, 404);
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
  return c.json({ handle: handle || null, offered: (await featuredCollections(-1)).collections });
});

admin.put("/starter", async (c) => {
  await requireAdmin(c);
  const body = await c.req.json<{ handle?: unknown }>().catch(() => ({}) as { handle?: unknown });
  const handle = typeof body.handle === "string" ? body.handle.trim().toLowerCase().replace(/^@/, "") : "";
  if (handle) {
    const [u] = (await db.execute<{ id: number }>(sql`select id from users where handle = ${handle}`)).rows;
    if (!u) return c.json({ error: "No account with that handle." }, 404);
  }
  await setSetting("starter_account", handle);
  return c.json({ handle: handle || null, offered: (await featuredCollections(-1)).collections });
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
