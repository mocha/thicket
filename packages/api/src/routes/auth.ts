/**
 * Sign up, log in, log out, and "me": the signed-in user's own profile and
 * settings. Public profile reads are in routes/profiles.ts.
 *
 * Account email and password reset are readthicket.com only (HOSTED); on a
 * self-hosted copy those routes answer 404, and sign up never asks for email.
 */
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { isShareLevel, type ShareLevel } from "../lib/visibility.js";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import {
  createSession, destroySession, destroyAllSessions, createUser, deleteUser, currentUser, findUserByHandle,
  handleProblem, hashPassword, normalizeHandle, verifyPassword, trackingEnabled,
} from "../lib/auth.js";
import { HOSTED } from "../lib/config.js";
import { parseDeviceId, parseSavedDisplay } from "../lib/display.js";
import { consumeInvite, findUsableInvite, publicStatus, signupPolicy, siteName } from "../lib/instance.js";
import { cleanEmail, looksLikeEmail, messages, send } from "../lib/mail.js";
import { issueToken, pendingEmail, takeToken } from "../lib/email-tokens.js";
import { LIMITS, clear, clientKey, hit, tooMany } from "../lib/ratelimit.js";

export const auth = new Hono();

const MIN_PASSWORD = 8;
const BAD_INVITE = "That invite code doesn’t work. It may have been mistyped or already used. Ask whoever invited you for a new invite link.";
const BAD_EMAIL = "That doesn’t look like an email address.";
const NOT_SENT = "We saved your email, but the confirmation didn’t send. Try Resend link in a few minutes.";

/** Everything the app needs about the signed-in user, including settings only they can see. */
async function me(userId: number) {
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!u) return null;
  const [avatar] = await db.select({ updatedAt: schema.userAvatars.updatedAt }).from(schema.userAvatars).where(eq(schema.userAvatars.userId, userId));
  const { passwordHash, ...rest } = u;
  return {
    ...rest, hasPassword: !!passwordHash, createdAt: u.createdAt.toISOString(), claimVerifiedAt: u.claimVerifiedAt?.toISOString() ?? null,
    emailConfirmedAt: u.emailConfirmedAt?.toISOString() ?? null, tourSeenAt: u.tourSeenAt?.toISOString() ?? null, displayOfferAnsweredAt: u.displayOfferAnsweredAt?.toISOString() ?? null, pendingEmail: await pendingEmail(u.id, u.emailConfirmedAt ? u.email : null),
    avatarUpdatedAt: avatar?.updatedAt.toISOString() ?? null, instanceTracking: trackingEnabled(),
  };
}

/** Email routes exist only on readthicket.com. */
const hostedOnly = (c: Context) => (HOSTED ? null : c.json({ error: "not found" }, 404));

/** Send a confirmation link for `email`. False if the mail didn't go out (already logged). */
async function sendConfirm(user: { id: number; handle: string }, email: string): Promise<boolean> {
  const token = await issueToken(user.id, "confirm", email);
  return send({ to: email, ...messages.confirm(user.handle, token) });
}

/** "Your password was changed", to a confirmed address. Fire and forget; send() logs a failure. */
async function notifyPasswordChanged(userId: number) {
  if (!HOSTED) return;
  const [u] = await db.select({ handle: schema.users.handle, email: schema.users.email, confirmed: schema.users.emailConfirmedAt }).from(schema.users).where(eq(schema.users.id, userId));
  if (u?.email && u.confirmed) void send({ to: u.email, ...messages.passwordChanged(u.handle) });
}

/** Instance name, public URL, and sign-up policy. Public; the sign-up page renders from it. */
auth.get("/status", async (c) => c.json(await publicStatus()));

auth.post("/signup", async (c) => {
  type Body = { handle?: string; password?: string; displayName?: string; inviteCode?: string; email?: string };
  const body = await c.req.json<Body>().catch(() => ({} as Body));
  const addr = clientKey(c);
  const flood = hit(`signup:${addr}`, LIMITS.signupAddress);
  if (!flood.ok) return tooMany(c, flood.retryAfterS, "There have been too many sign ups from your internet connection.");
  const policy = await signupPolicy();
  if (policy === "closed") return c.json({ error: `Sign ups are closed for ${await siteName()}.` }, 403);
  const invite = policy === "invite" ? await findUsableInvite((body.inviteCode ?? "").trim()) : null;
  if (policy === "invite" && !invite) return c.json({ error: body.inviteCode ? BAD_INVITE : `You need an invite to sign up for ${await siteName()}. Ask someone who already has an account to send you an invite link. It will bring you back here.`, field: "inviteCode" }, 403);
  const handle = normalizeHandle(body.handle ?? "");
  const problem = handleProblem(handle);
  if (problem) return c.json({ error: problem, field: "handle" }, 400);
  if (!body.password || body.password.length < MIN_PASSWORD) return c.json({ error: `Use at least ${MIN_PASSWORD} characters.`, field: "password" }, 400);
  const email = HOSTED ? cleanEmail(body.email) : null;
  if (HOSTED && !looksLikeEmail(email!)) return c.json({ error: email ? BAD_EMAIL : "Enter your email so you can reset your password if you forget it.", field: "email" }, 400);
  if (await findUserByHandle(handle)) return c.json({ error: "Someone already has that handle. Try another one.", field: "handle" }, 409);
  const user = await createUser({ handle, password: body.password, displayName: body.displayName, email });
  // Claim the invite atomically. If two signups raced on the same code, only one
  // wins; the loser undoes its just-created account (no session exists yet) so an
  // invite can never yield two accounts.
  if (invite && !(await consumeInvite(invite.code, user.id))) {
    await deleteUser(user.id);
    return c.json({ error: BAD_INVITE, field: "inviteCode" }, 403);
  }
  await createSession(c, user.id);
  // The account works either way; a confirmation that didn't send is resent from the Account page.
  if (email) await sendConfirm(user, email);
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

/** Record that the setup tour has been seen, so no device shows it again. The first time stands. */
auth.post("/me/tour", async (c) => {
  const user = currentUser(c);
  await db.update(schema.users).set({ tourSeenAt: new Date() }).where(and(eq(schema.users.id, user.id), isNull(schema.users.tourSeenAt)));
  return c.body(null, 204);
});

/**
 * Save display settings to offer new devices (issue #186), replacing any saved
 * before. The web app calls this only on purpose: a new account's first setup,
 * "Use these settings on new devices", or an older account's first device
 * after this change. Saving marks the account as having had a first device
 * (so the default never applies twice), and ends a new account's "save my
 * first setup".
 * `device` makes the sending device the one that keeps them up to date.
 * A refusal says what was wrong and is logged, so support can see it too.
 */
auth.put("/me/display", bodyLimit({ maxSize: 4096, onError: (c) => c.json({ error: "settings are too large" }, 413) }), async (c) => {
  const user = currentUser(c);
  const body = await c.req.json<{ settings?: unknown; device?: unknown }>().catch(() => ({} as { settings?: unknown; device?: unknown }));
  const parsed = parseSavedDisplay(body.settings);
  if (!parsed.ok) {
    console.warn(`[display] refused saved settings for user ${user.id}: ${parsed.error}`);
    return c.json({ error: parsed.error }, 400);
  }
  await db.update(schema.users)
    .set({ savedDisplay: parsed.value, displaySource: parseDeviceId(body.device), saveFirstDisplay: false, displayOfferAnsweredAt: sql`coalesce(${schema.users.displayOfferAnsweredAt}, now())` })
    .where(eq(schema.users.id, user.id));
  return c.json(await me(user.id));
});

/** Stop a device keeping the saved settings up to date. Only that device can: another device unchecking has nothing to stop. The saved settings stay. */
auth.delete("/me/display-source", async (c) => {
  const user = currentUser(c);
  const body = await c.req.json<{ device?: unknown }>().catch(() => ({} as { device?: unknown }));
  const device = parseDeviceId(body.device);
  if (device) await db.update(schema.users).set({ displaySource: null }).where(and(eq(schema.users.id, user.id), eq(schema.users.displaySource, device)));
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
  await notifyPasswordChanged(user.id);
  return c.body(null, 204);
});

// ---- account email (readthicket.com only) ------------------------------------

/**
 * Add or change my email. Asks for the current password, so someone at an
 * unlocked laptop can't point the reset links at themselves.
 *
 * With no confirmed address yet, the new one simply replaces whatever is
 * there. With a confirmed one, the new address waits on its confirmation link
 * and the old one keeps getting resets until then, so a typo can't lock anyone
 * out; the old address gets a note saying a change was asked for.
 */
auth.put("/me/email", async (c) => {
  const blocked = hostedOnly(c); if (blocked) return blocked;
  const user = currentUser(c);
  const body = await c.req.json<{ email?: string; password?: string }>().catch(() => ({} as { email?: string; password?: string }));
  const email = cleanEmail(body.email);
  if (!looksLikeEmail(email)) return c.json({ error: BAD_EMAIL, field: "email" }, 400);
  const [row] = await db.select().from(schema.users).where(eq(schema.users.id, user.id));
  if (!(await verifyPassword(body.password ?? "", row.passwordHash))) return c.json({ error: "Current password is wrong.", field: "password" }, 400);
  const flood = hit(`email-send:${user.id}`, LIMITS.emailSend);
  if (!flood.ok) return tooMany(c, flood.retryAfterS, "That’s a lot of confirmation emails.");
  if (row.emailConfirmedAt && row.email) {
    if (row.email.toLowerCase() === email.toLowerCase()) return c.json({ error: "That’s already your email.", field: "email" }, 400);
    void send({ to: row.email, ...messages.changed(row.handle, email) });
  } else {
    await db.update(schema.users).set({ email, emailConfirmedAt: null }).where(eq(schema.users.id, user.id));
  }
  const sent = await sendConfirm(row, email);
  return c.json({ me: await me(user.id), sent, ...(sent ? {} : { error: NOT_SENT }) });
});

/** Send the confirmation link again, for whichever address is waiting on one. */
auth.post("/me/email/resend", async (c) => {
  const blocked = hostedOnly(c); if (blocked) return blocked;
  const user = currentUser(c);
  const [row] = await db.select().from(schema.users).where(eq(schema.users.id, user.id));
  const target = row.emailConfirmedAt ? await pendingEmail(user.id, row.email) : row.email;
  if (!target) return c.json({ error: "There’s no email waiting to be confirmed." }, 400);
  const flood = hit(`email-send:${user.id}`, LIMITS.emailSend);
  if (!flood.ok) return tooMany(c, flood.retryAfterS, "That’s a lot of confirmation emails.");
  const sent = await sendConfirm(row, target);
  if (!sent) return c.json({ error: "The confirmation didn’t send. Try again in a few minutes." }, 502);
  return c.json({ email: target });
});

/**
 * The confirmation link lands here (via the web page it opens). No sign-in
 * needed: people often click it on a different device. The address becomes
 * the account's email only if nothing newer has replaced it since.
 */
auth.post("/confirm-email", async (c) => {
  const blocked = hostedOnly(c); if (blocked) return blocked;
  const body = await c.req.json<{ token?: string }>().catch(() => ({} as { token?: string }));
  const row = await takeToken(body.token ?? "", "confirm");
  if (!row) return c.json({ error: "That link doesn’t work anymore." }, 410);
  await db.update(schema.users).set({ email: row.email, emailConfirmedAt: new Date() }).where(eq(schema.users.id, row.userId));
  return c.body(null, 204);
});

/**
 * "Forgot your password?" Takes a handle or an email, and always answers the
 * same way, whether or not any account matched, so it can't be used to learn
 * who has an account. The mail goes out after the answer, so how long the
 * answer takes gives nothing away either. Only confirmed addresses get links.
 */
auth.post("/forgot-password", async (c) => {
  const blocked = hostedOnly(c); if (blocked) return blocked;
  const body = await c.req.json<{ who?: string }>().catch(() => ({} as { who?: string }));
  const who = (body.who ?? "").trim();
  const flood = hit(`forgot-addr:${clientKey(c)}`, LIMITS.forgotAddress);
  if (!flood.ok) return tooMany(c, flood.retryAfterS, "Too many reset requests from here.");
  const byEmail = who.includes("@") && !who.startsWith("@");
  const key = byEmail ? who.toLowerCase() : normalizeHandle(who);
  // Over the per-account limit: answer as usual, send nothing.
  if (key && hit(`forgot-target:${key}`, LIMITS.forgotTarget).ok) {
    const matches = await db.select({ id: schema.users.id, handle: schema.users.handle, email: schema.users.email }).from(schema.users).where(and(
      isNotNull(schema.users.emailConfirmedAt),
      byEmail ? eq(sql`lower(${schema.users.email})`, key) : eq(schema.users.handle, key),
    ));
    void (async () => {
      for (const u of matches) {
        const token = await issueToken(u.id, "reset", u.email!);
        await send({ to: u.email!, ...messages.reset(u.handle, token) });
      }
    })().catch((e) => console.error("[mail] reset links failed:", e));
  }
  return c.body(null, 204);
});

/**
 * Choose a new password from a reset link. Checks the new password before
 * using the link up, so a too-short password doesn't waste it. Signs out every
 * other device, signs in this one, and sends "your password was changed".
 */
auth.post("/reset-password", async (c) => {
  const blocked = hostedOnly(c); if (blocked) return blocked;
  const body = await c.req.json<{ token?: string; password?: string }>().catch(() => ({} as { token?: string; password?: string }));
  if (!body.password || body.password.length < MIN_PASSWORD) return c.json({ error: `Use at least ${MIN_PASSWORD} characters.`, field: "password" }, 400);
  const row = await takeToken(body.token ?? "", "reset");
  if (!row) return c.json({ error: "That link doesn’t work anymore." }, 410);
  await db.update(schema.users).set({ passwordHash: await hashPassword(body.password) }).where(eq(schema.users.id, row.userId));
  await destroyAllSessions(row.userId);
  await createSession(c, row.userId);
  await notifyPasswordChanged(row.userId);
  return c.json(await me(row.userId));
});
