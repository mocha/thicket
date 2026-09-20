/**
 * Sign up, log in, log out, and "me": the signed-in user's own profile and
 * settings. Public profile reads are in routes/profiles.ts.
 */
import { Hono } from "hono";
import { isShareLevel, type ShareLevel } from "../lib/visibility.js";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import {
  createSession, destroySession, destroyAllSessions, createUser, currentUser, findUserByHandle,
  handleProblem, hashPassword, normalizeHandle, verifyPassword, trackingEnabled,
} from "../lib/auth.js";
import { consumeInvite, findUsableInvite, publicStatus, signupPolicy } from "../lib/instance.js";
import { LIMITS, clear, clientKey, hit, tooMany } from "../lib/ratelimit.js";

export const auth = new Hono();

const MIN_PASSWORD = 8;

/** Everything the app needs about the signed-in user, including settings only they can see. */
async function me(userId: number) {
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!u) return null;
  const { passwordHash, ...rest } = u;
  return { ...rest, hasPassword: !!passwordHash, createdAt: u.createdAt.toISOString(), claimVerifiedAt: u.claimVerifiedAt?.toISOString() ?? null, instanceTracking: trackingEnabled() };
}

/** Instance name, public URL, and sign-up policy. Public; the sign-up page renders from it. */
auth.get("/status", async (c) => c.json(await publicStatus()));

auth.post("/signup", async (c) => {
  type Body = { handle?: string; password?: string; displayName?: string; inviteCode?: string };
  const body = await c.req.json<Body>().catch(() => ({} as Body));
  const addr = clientKey(c);
  const flood = hit(`signup:${addr}`, LIMITS.signupAddress);
  if (!flood.ok) return tooMany(c, flood.retryAfterS, "Too many sign-ups from here.");
  const policy = await signupPolicy();
  if (policy === "closed") return c.json({ error: "Sign-ups are closed on this instance." }, 403);
  const invite = policy === "invite" ? await findUsableInvite((body.inviteCode ?? "").trim()) : null;
  if (policy === "invite" && !invite) return c.json({ error: body.inviteCode ? "That invite isn’t valid any more." : "This instance is invite-only. Ask a member for an invite link.", field: "inviteCode" }, 403);
  const handle = normalizeHandle(body.handle ?? "");
  const problem = handleProblem(handle);
  if (problem) return c.json({ error: problem, field: "handle" }, 400);
  if (!body.password || body.password.length < MIN_PASSWORD) return c.json({ error: `Use at least ${MIN_PASSWORD} characters.`, field: "password" }, 400);
  if (await findUserByHandle(handle)) return c.json({ error: "That handle is taken.", field: "handle" }, 409);
  const user = await createUser({ handle, password: body.password, displayName: body.displayName });
  if (invite) await consumeInvite(invite.code, user.id);
  await createSession(c, user.id);
  return c.json(await me(user.id), 201);
});

auth.post("/login", async (c) => {
  const body = await c.req.json<{ handle?: string; password?: string }>().catch(() => ({} as { handle?: string; password?: string }));
  const handle = normalizeHandle(body.handle ?? "");
  const addr = clientKey(c);
  // Both windows are counted before the password is checked, so guessing costs
  // an attempt whether or not the handle exists — and costs us no scrypt work.
  const byAddress = hit(`login-addr:${addr}`, LIMITS.loginAddress);
  if (!byAddress.ok) return tooMany(c, byAddress.retryAfterS, "Too many sign-in attempts from here.");
  const handleKey = `login-handle:${handle}`;
  if (handle) {
    const byHandle = hit(handleKey, LIMITS.loginHandle);
    // Same wording as a wrong password: a locked account must not be a way to
    // learn that the handle is real.
    if (!byHandle.ok) return tooMany(c, byHandle.retryAfterS, "Too many sign-in attempts.");
  }
  const user = handle ? await findUserByHandle(handle) : null;
  // Same message either way; do not confirm which handles exist.
  if (!user || !(await verifyPassword(body.password ?? "", user.passwordHash))) return c.json({ error: "Wrong handle or password." }, 401);
  clear(handleKey); // one good password clears the slate
  await createSession(c, user.id);
  return c.json(await me(user.id));
});

auth.post("/logout", async (c) => {
  await destroySession(c);
  return c.body(null, 204);
});

auth.get("/me", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "signed out" }, 401);
  return c.json(await me(user.id));
});

const MAX = { displayName: 60, bio: 500, homepageUrl: 300 };

/** Profile fields and visibility toggles. Partial; only sent keys change. */
auth.patch("/me", async (c) => {
  const user = currentUser(c);
  type Patch = Partial<{
    displayName: string | null; bio: string | null; homepageUrl: string | null;
    profileVisibility: "public" | "private"; trackActivity: boolean | null;
    collectionsVisibility: ShareLevel; bookmarksVisibility: ShareLevel; notesVisibility: ShareLevel;
    activityVisibility: ShareLevel;
    notesFrom: "none" | "following" | "everyone";
    hideShortsByDefault: boolean;
  }>;
  const body = await c.req.json<Patch>().catch(() => ({} as Patch));
  const patch: Partial<typeof schema.users.$inferInsert> = {};
  const clean = (v: string | null | undefined, max: number) => (v === undefined ? undefined : (v ?? "").trim().slice(0, max) || null);
  if ("displayName" in body) patch.displayName = clean(body.displayName, MAX.displayName);
  if ("bio" in body) patch.bio = clean(body.bio, MAX.bio);
  if ("homepageUrl" in body) {
    let url = clean(body.homepageUrl, MAX.homepageUrl);
    if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;
    if (url) {
      try { new URL(url); } catch { return c.json({ error: "That doesn’t look like a URL.", field: "homepageUrl" }, 400); }
    }
    patch.homepageUrl = url;
  }
  if (body.profileVisibility === "public" || body.profileVisibility === "private") patch.profileVisibility = body.profileVisibility;
  if (isShareLevel(body.collectionsVisibility)) patch.collectionsVisibility = body.collectionsVisibility;
  if (isShareLevel(body.bookmarksVisibility)) patch.bookmarksVisibility = body.bookmarksVisibility;
  if (isShareLevel(body.notesVisibility)) patch.notesVisibility = body.notesVisibility;
  if (isShareLevel(body.activityVisibility)) patch.activityVisibility = body.activityVisibility;
  if (body.notesFrom === "none" || body.notesFrom === "following" || body.notesFrom === "everyone") patch.notesFrom = body.notesFrom;
  if ("trackActivity" in body && (body.trackActivity === null || typeof body.trackActivity === "boolean")) patch.trackActivity = body.trackActivity;
  if (typeof body.hideShortsByDefault === "boolean") patch.hideShortsByDefault = body.hideShortsByDefault;
  if (Object.keys(patch).length) await db.update(schema.users).set(patch).where(eq(schema.users.id, user.id));
  return c.json(await me(user.id));
});

/** Change password. Requires the current one; signs out every other session. */
auth.post("/me/password", async (c) => {
  const user = currentUser(c);
  const body = await c.req.json<{ current?: string; next?: string }>().catch(() => ({} as { current?: string; next?: string }));
  const [row] = await db.select({ passwordHash: schema.users.passwordHash }).from(schema.users).where(eq(schema.users.id, user.id));
  if (row.passwordHash && !(await verifyPassword(body.current ?? "", row.passwordHash))) return c.json({ error: "Current password is wrong.", field: "current" }, 400);
  if (!body.next || body.next.length < MIN_PASSWORD) return c.json({ error: `Use at least ${MIN_PASSWORD} characters.`, field: "next" }, 400);
  await db.update(schema.users).set({ passwordHash: await hashPassword(body.next) }).where(eq(schema.users.id, user.id));
  await destroyAllSessions(user.id);
  await createSession(c, user.id);
  return c.body(null, 204);
});
