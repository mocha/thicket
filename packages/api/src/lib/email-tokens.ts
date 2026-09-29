/**
 * The single-use links we email (schema.emailTokens). A confirm link lasts a
 * day, a reset link an hour. The link carries a random token; we keep only its
 * sha256, the same as sessions.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gt, isNull, ne, sql } from "drizzle-orm";
import { db, schema } from "../db/client.js";

export type Purpose = "confirm" | "reset";
const TTL_MS: Record<Purpose, number> = { confirm: 24 * 3600_000, reset: 3600_000 };

const hashOf = (token: string) => createHash("sha256").update(token).digest("hex");

/** Mint a link. A new one retires any earlier unused link of the same kind for that account. */
export async function issueToken(userId: number, purpose: Purpose, email: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.transaction(async (tx) => {
    await tx.update(schema.emailTokens).set({ usedAt: new Date() }).where(and(eq(schema.emailTokens.userId, userId), eq(schema.emailTokens.purpose, purpose), isNull(schema.emailTokens.usedAt)));
    await tx.insert(schema.emailTokens).values({ id: hashOf(token), userId, purpose, email, expiresAt: new Date(Date.now() + TTL_MS[purpose]) });
  });
  return token;
}

/**
 * Use a link up. Atomic and single-winner, like consumeInvite: only an unused,
 * unexpired token of the right kind matches, and marking it used is the same
 * statement, so two clicks can't both succeed.
 */
export async function takeToken(token: string, purpose: Purpose) {
  if (!token) return null;
  const [row] = await db.update(schema.emailTokens).set({ usedAt: new Date() })
    .where(and(eq(schema.emailTokens.id, hashOf(token)), eq(schema.emailTokens.purpose, purpose), isNull(schema.emailTokens.usedAt), gt(schema.emailTokens.expiresAt, sql`now()`)))
    .returning();
  return row ?? null;
}

/** A new address waiting on its confirmation link, while the current one still gets resets. */
export async function pendingEmail(userId: number, current: string | null): Promise<string | null> {
  if (!current) return null;
  const [row] = await db.select({ email: schema.emailTokens.email }).from(schema.emailTokens)
    .where(and(
      eq(schema.emailTokens.userId, userId), eq(schema.emailTokens.purpose, "confirm"), isNull(schema.emailTokens.usedAt),
      gt(schema.emailTokens.expiresAt, sql`now()`), ne(schema.emailTokens.email, current),
    ))
    .orderBy(desc(schema.emailTokens.createdAt)).limit(1);
  return row?.email ?? null;
}

/** Housekeeping: links a week past expiry are no use to anyone. */
export async function pruneEmailTokens(): Promise<void> {
  await db.delete(schema.emailTokens).where(gt(sql`now() - interval '7 days'`, schema.emailTokens.expiresAt));
}
