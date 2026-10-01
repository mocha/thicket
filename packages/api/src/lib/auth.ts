/**
 * Authentication. Handle + password, opaque session cookie.
 *
 * - Passwords: scrypt from node:crypto. No new dependency, memory-hard, fine at
 *   this scale. Stored as "scrypt$<salt>$<hash>" so the algorithm can change
 *   later without a migration (verify() dispatches on the prefix).
 * - Sessions: 32 random bytes in an HttpOnly cookie; the database holds the
 *   sha256 of the token. Sliding 30-day expiry, renewed on use.
 * - API tokens (issue #140): a request with `Authorization: Bearer thk_…` is
 *   its owner, within what a token may do. Checked here, in attachUser(), for
 *   every route at once; lib/token-access.ts holds the rules.
 * - Middleware: attachUser() runs on every /api request and sets c.var.user
 *   (or null). Routes call currentUser(c) for a hard 401, or c.get("user")
 *   when anonymous access is fine (public profiles, icons).
 */
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import { IS_HTTPS, TRACK_ACTIVITY } from "./config.js";
import { LIMITS, hitRolling } from "./ratelimit.js";
import { bearerOf, hashToken, looksLikeToken, tokenMay, type TokenKind } from "./token-access.js";

const scrypt = promisify(scryptCb);
export const COOKIE = "thicket_session";
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
const RENEW_AFTER_MS = 24 * 3600 * 1000;

export type SessionUser = {
  id: number;
  handle: string;
  displayName: string | null;
  /** The tree's parent row. Structural only: it is never shown and never holds feeds. */
  rootCollectionId: number;
  /** Where a bare "Follow" files a feed: the oldest collection. Null only if every one was deleted. */
  defaultCollectionId: number | null;
  /** Effective tracking flag: per-user override, else the instance setting. */
  trackActivity: boolean;
};

declare module "hono" {
  interface ContextVariableMap {
    user: SessionUser | null;
    sessionId: string | null;
    /** Set when the request came with an API token instead of a session. */
    token: { id: number; kind: TokenKind } | null;
  }
}

// ---- passwords ------------------------------------------------------------

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = (await scrypt(password.normalize("NFKC"), salt, 64)) as Buffer;
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [algo, saltHex, hashHex] = stored.split("$");
  if (algo !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = (await scrypt(password.normalize("NFKC"), Buffer.from(saltHex, "hex"), expected.length)) as Buffer;
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// ---- handles --------------------------------------------------------------

export const HANDLE_RE = /^[a-z0-9][a-z0-9_-]{1,29}$/;
/** Routes and words that would collide with URLs or read as official. */
const RESERVED = new Set(["me", "admin", "administrator", "thicket", "api", "feeds", "feed", "collections", "collection", "bookmarks", "bookmark", "add", "login", "logout", "signup", "settings", "about", "help", "support", "root", "system", "everything", "river", "static", "assets", "null", "undefined"]);

export function normalizeHandle(raw: string): string {
  return raw.trim().toLowerCase().replace(/^@/, "");
}
export function handleProblem(handle: string): string | null {
  if (!HANDLE_RE.test(handle)) return "A handle needs 2 to 30 characters and must start with a letter or number. You can use lowercase letters, numbers, hyphens, and/or underscores.";
  if (RESERVED.has(handle)) return "That handle is reserved for thicket itself. Try another one.";
  return null;
}

// ---- sessions -------------------------------------------------------------

const tokenId = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createSession(c: Context, userId: number): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(schema.sessions).values({ id: tokenId(token), userId, userAgent: c.req.header("user-agent")?.slice(0, 200) ?? null, expiresAt });
  writeCookie(c, token, expiresAt);
}

export async function destroySession(c: Context): Promise<void> {
  const token = getCookie(c, COOKIE);
  if (token) await db.delete(schema.sessions).where(eq(schema.sessions.id, tokenId(token)));
  deleteCookie(c, COOKIE, { path: "/" });
}

/** Log out everywhere: every session for this user. */
export async function destroyAllSessions(userId: number): Promise<void> {
  await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
}

function writeCookie(c: Context, token: string, expiresAt: Date) {
  // Secure only when the instance is reached over https (PUBLIC_URL). A LAN
  // instance on plain http would otherwise never get its cookie back.
  const secure = IS_HTTPS || c.req.header("x-forwarded-proto") === "https";
  setCookie(c, COOKIE, token, { path: "/", httpOnly: true, sameSite: "Lax", secure, expires: expiresAt });
}

type UserRow = {
  id: number; handle: string; displayName: string | null; trackActivity: boolean | null; rootCollectionId: number | null;
  defaultCollectionId: number | null;
};
/** The columns every request's user is made of, whichever credential named them. */
const userColumns = sql`
  u.id, u.handle, u.display_name as "displayName", u.track_activity as "trackActivity",
  (select col.id from collections col where col.user_id = u.id and col.parent_id is null limit 1) as "rootCollectionId",
  (select col.id from collections col where col.user_id = u.id and col.parent_id is not null order by col.id limit 1) as "defaultCollectionId"`;
const toUser = (row: UserRow): SessionUser => ({
  id: Number(row.id), handle: row.handle, displayName: row.displayName, rootCollectionId: Number(row.rootCollectionId),
  defaultCollectionId: row.defaultCollectionId === null ? null : Number(row.defaultCollectionId),
  trackActivity: row.trackActivity ?? trackingEnabled(),
});

/** How often a token's "last used" moves. */
const TOKEN_SEEN_EVERY_MS = 60_000;

/**
 * A request carrying `Authorization: Bearer …` is a token request (issue
 * #140) and nothing else: any cookie beside it is ignored. This is the one
 * place a token is checked, so no route has to remember to. In order: is it a
 * live token, is it within its rate limits, and may a token of its kind make
 * this request at all (lib/token-access.ts). Returns the refusal, or null
 * once the user is attached.
 */
async function attachTokenUser(c: Context, raw: string): Promise<Response | null> {
  const refuse = (status: 401 | 403 | 429, error: string, extra: Record<string, unknown> = {}) => c.json({ error, ...extra }, status);
  const BAD = "That API token doesn’t work. It may have been mistyped or revoked.";
  if (!looksLikeToken(raw)) return refuse(401, BAD);
  const row = (await db.execute<UserRow & { tokenId: number; kind: TokenKind; lastUsedAt: string | null }>(sql`
    select ${userColumns}, t.id as "tokenId", t.kind, t.last_used_at as "lastUsedAt"
    from api_tokens t join users u on u.id = t.user_id
    where t.token_hash = ${hashToken(raw)}
  `)).rows[0];
  if (!row || row.rootCollectionId === null) return refuse(401, BAD);

  const pace = hitRolling(`token:${row.tokenId}`, [LIMITS.tokenBurst, LIMITS.tokenHourly]);
  if (!pace.ok) {
    c.header("retry-after", String(pace.retryAfterS));
    const mins = Math.ceil(pace.retryAfterS / 60);
    const message = pace.broke === LIMITS.tokenBurst
      ? `Too many requests at once. A token can make ${LIMITS.tokenBurst.limit} in any ${LIMITS.tokenBurst.windowMs / 1000} seconds. Try again in ${pace.retryAfterS === 1 ? "a second" : `${pace.retryAfterS} seconds`}.`
      : `That’s a lot of requests for one hour. A token can make ${LIMITS.tokenHourly.limit} in any hour. Try again in ${mins === 1 ? "a minute" : `${mins} minutes`}.`;
    return refuse(429, message, { retryAfterS: pace.retryAfterS });
  }

  const may = tokenMay(row.kind, c.req.method, c.req.path);
  if (!may.ok) return refuse(403, may.error);

  c.set("user", toUser(row));
  c.set("token", { id: Number(row.tokenId), kind: row.kind });
  if (!row.lastUsedAt || Date.now() - new Date(row.lastUsedAt).getTime() > TOKEN_SEEN_EVERY_MS) {
    await db.update(schema.apiTokens).set({ lastUsedAt: new Date() }).where(eq(schema.apiTokens.id, Number(row.tokenId)));
  }
  return null;
}

/**
 * Resolves the credential to a user once per request: an API token if the
 * request carries one, else the session cookie. A request with neither, or
 * with a cookie that no longer works, goes on as a visitor and routes decide.
 * A token that doesn't work, or isn't allowed this request, is answered here.
 */
export const attachUser: MiddlewareHandler = async (c, next) => {
  c.set("user", null);
  c.set("sessionId", null);
  c.set("token", null);
  const bearer = bearerOf(c.req.header("authorization"));
  if (bearer !== null) {
    const refusal = await attachTokenUser(c, bearer);
    if (refusal) return refusal;
    return next();
  }
  const token = getCookie(c, COOKIE);
  if (token) {
    const id = tokenId(token);
    const rows = await db.execute<UserRow & { lastSeenAt: string; expiresAt: string }>(sql`
      select ${userColumns}, s.last_seen_at as "lastSeenAt", s.expires_at as "expiresAt"
      from sessions s join users u on u.id = s.user_id
      where s.id = ${id} and s.expires_at > now()
    `);
    const row = rows.rows[0];
    if (row && row.rootCollectionId !== null) {
      c.set("user", toUser(row));
      c.set("sessionId", id);
      // Sliding expiry, written at most once a day so reads stay reads.
      if (Date.now() - new Date(row.lastSeenAt).getTime() > RENEW_AFTER_MS) {
        const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
        await db.update(schema.sessions).set({ lastSeenAt: new Date(), expiresAt }).where(eq(schema.sessions.id, id));
        writeCookie(c, token, expiresAt);
      }
    }
  }
  await next();
};

/** The signed-in user, or a 401. Every route that touches "my" data calls this. */
export function currentUser(c: Context): SessionUser {
  const user = c.get("user");
  if (!user) throw new HTTPException(401, { res: Response.json({ error: "sign in required" }, { status: 401 }) });
  return user;
}

export function trackingEnabled(): boolean {
  return TRACK_ACTIVITY;
}

// ---- users ----------------------------------------------------------------

/**
 * Create a user, the structural root of their collection tree, and the one
 * collection they start with. Every feed a person follows lives in a
 * collection, so an account with none would have nowhere to put its first
 * feed; "My first collection" is an ordinary collection from the moment it
 * exists — rename it, delete it once there is another, share it.
 */
export async function createUser(input: { handle: string; password: string; displayName?: string | null; email?: string | null }) {
  const passwordHash = await hashPassword(input.password);
  return db.transaction(async (tx) => {
    // First account on the instance is the admin.
    const [{ n }] = (await tx.execute<{ n: number }>(sql`select count(*)::int as n from users`)).rows;
    const [user] = await tx.insert(schema.users).values({ handle: input.handle, passwordHash, displayName: input.displayName?.trim() || null, email: input.email ?? null, isAdmin: n === 0 }).returning();
    const [root] = await tx.insert(schema.collections).values({ userId: user.id, parentId: null, name: "All collections", slug: ROOT_SLUG }).returning();
    await tx.insert(schema.collections).values({ userId: user.id, parentId: root.id, name: FIRST_COLLECTION_NAME, slug: FIRST_COLLECTION_SLUG });
    return user;
  });
}

export async function findUserByHandle(handle: string) {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.handle, handle));
  return user ?? null;
}

/** Remove a user and everything that cascades from it (collections, sessions, ...). */
export async function deleteUser(userId: number): Promise<void> {
  await db.delete(schema.users).where(eq(schema.users.id, userId));
}

/** The collection a brand-new account starts with. Also the rescue name when someone deletes their last one. */
/** The root is never rendered and never addressed. A leading double dash is
 * something slugify() cannot produce, so no name anyone types can collide. */
export const ROOT_SLUG = "--root";

export const FIRST_COLLECTION_NAME = "My first collection";
export const FIRST_COLLECTION_SLUG = "my-first-collection";

export async function rootCollectionOf(userId: number): Promise<number | null> {
  const [root] = await db.select({ id: schema.collections.id }).from(schema.collections).where(and(eq(schema.collections.userId, userId), isNull(schema.collections.parentId)));
  return root?.id ?? null;
}

/** Housekeeping: drop expired sessions. Called from the scheduler tick occasionally. */
export async function pruneSessions(): Promise<void> {
  await db.delete(schema.sessions).where(gt(sql`now()`, schema.sessions.expiresAt));
}
