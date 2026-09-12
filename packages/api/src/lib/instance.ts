/**
 * Instance-level state: settings an admin can change, invite codes, and the
 * "first account is the admin" rule.
 *
 * Sign-up policy resolves as: no users yet → open (someone has to be first);
 * otherwise the stored setting; otherwise the SIGNUPS env default ("invite").
 * A public address with open sign-ups is the spam funnel every small instance
 * regrets, so invite-only is the default the moment there is an owner.
 */
import { randomBytes } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import { INSTANCE_NAME, PUBLIC_URL, SIGNUPS_DEFAULT } from "./config.js";

export type SignupPolicy = "open" | "invite" | "closed";

export async function getSetting<T>(key: string): Promise<T | undefined> {
  const [row] = await db.select().from(schema.instanceSettings).where(eq(schema.instanceSettings.key, key));
  return row?.value as T | undefined;
}
export async function setSetting(key: string, value: unknown): Promise<void> {
  await db.insert(schema.instanceSettings).values({ key, value }).onConflictDoUpdate({ target: schema.instanceSettings.key, set: { value, updatedAt: new Date() } });
}

export async function userCount(): Promise<number> {
  const [{ n }] = (await db.execute<{ n: number }>(sql`select count(*)::int as n from users`)).rows;
  return n;
}

export async function signupPolicy(): Promise<SignupPolicy> {
  if ((await userCount()) === 0) return "open";
  return (await getSetting<SignupPolicy>("signups")) ?? SIGNUPS_DEFAULT;
}

/** What the sign-up page needs to render itself. Public. */
export async function publicStatus() {
  return { name: (await getSetting<string>("name")) ?? INSTANCE_NAME, url: PUBLIC_URL, signups: await signupPolicy() };
}

/** Self-healing: if nobody is admin, the oldest account is. Runs at boot and after the first sign-up. */
export async function ensureAdmin(): Promise<void> {
  const [{ n }] = (await db.execute<{ n: number }>(sql`select count(*)::int as n from users where is_admin`)).rows;
  if (n > 0) return;
  await db.execute(sql`update users set is_admin = true where id = (select min(id) from users)`);
}

// ---- invites --------------------------------------------------------------

export async function createInvite(byUserId: number, note?: string | null, ttlDays = 14) {
  const code = randomBytes(9).toString("base64url");
  const [row] = await db.insert(schema.invites).values({ code, createdBy: byUserId, note: note ?? null, expiresAt: new Date(Date.now() + ttlDays * 86400_000) }).returning();
  return { ...row, url: inviteUrl(code) };
}
export const inviteUrl = (code: string) => `${PUBLIC_URL}/signup?invite=${encodeURIComponent(code)}`;

export async function listInvites() {
  const rows = await db.execute(sql`
    select i.code, i.note, i.created_at as "createdAt", i.expires_at as "expiresAt", i.used_at as "usedAt",
           u.handle as "usedByHandle", c.handle as "createdByHandle"
    from invites i join users c on c.id = i.created_by left join users u on u.id = i.used_by
    order by i.created_at desc limit 100
  `);
  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
  return rows.rows.map((r: any) => ({ ...r, createdAt: iso(r.createdAt), expiresAt: iso(r.expiresAt), usedAt: iso(r.usedAt), url: inviteUrl(r.code) }));
}

/** Valid = exists, unused, unexpired. */
export async function findUsableInvite(code: string) {
  const [row] = await db.select().from(schema.invites).where(and(eq(schema.invites.code, code), isNull(schema.invites.usedBy)));
  if (!row) return null;
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return null;
  return row;
}
export async function consumeInvite(code: string, userId: number): Promise<void> {
  await db.update(schema.invites).set({ usedBy: userId, usedAt: new Date() }).where(eq(schema.invites.code, code));
}
export async function revokeInvite(code: string): Promise<boolean> {
  const rows = await db.delete(schema.invites).where(and(eq(schema.invites.code, code), isNull(schema.invites.usedBy))).returning();
  return rows.length > 0;
}
