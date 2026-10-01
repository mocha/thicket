/**
 * My API tokens (issue #140), as the Account page manages them: see the two I
 * may have, turn one on, turn one off. At most one of each kind, so the kind
 * is the address: /api/tokens/read and /api/tokens/full.
 *
 * Only a signed-in browser reaches these. A token can never list, make or
 * revoke tokens; the auth middleware refuses it before it gets here
 * (lib/token-access.ts).
 *
 * The list includes each token itself, because the page shows it again on
 * request. See the note on the table in db/schema.ts.
 */
import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import { currentUser } from "../lib/user.js";
import { TOKEN_KINDS, hashToken, newToken, type TokenKind } from "../lib/token-access.js";

export const tokens = new Hono();

type Row = typeof schema.apiTokens.$inferSelect;
const shape = (t: Row) => ({
  kind: t.kind, token: t.token,
  createdAt: new Date(t.createdAt).toISOString(),
  lastUsedAt: t.lastUsedAt ? new Date(t.lastUsedAt).toISOString() : null,
});
const kindOf = (raw: string): TokenKind | null => (TOKEN_KINDS as string[]).includes(raw) ? (raw as TokenKind) : null;

/** The tokens I have turned on: none, one or both. */
tokens.get("/", async (c) => {
  const user = currentUser(c);
  const rows = await db.select().from(schema.apiTokens).where(eq(schema.apiTokens.userId, user.id));
  return c.json({ tokens: rows.map(shape) });
});

/** Turn one on. If it is already on, this answers with the one there is: it never replaces a token in use. */
tokens.post("/:kind", async (c) => {
  const user = currentUser(c);
  const kind = kindOf(c.req.param("kind"));
  if (!kind) return c.json({ error: "not found" }, 404);
  const token = newToken(kind);
  const [made] = await db.insert(schema.apiTokens).values({ userId: user.id, kind, token, tokenHash: hashToken(token) }).onConflictDoNothing().returning();
  if (made) return c.json(shape(made), 201);
  const [existing] = await db.select().from(schema.apiTokens).where(and(eq(schema.apiTokens.userId, user.id), eq(schema.apiTokens.kind, kind)));
  return c.json(shape(existing), 200);
});

/** Revoke one. Anything using it stops working at once; turning it on again makes a different token. */
tokens.delete("/:kind", async (c) => {
  const user = currentUser(c);
  const kind = kindOf(c.req.param("kind"));
  if (!kind) return c.json({ error: "not found" }, 404);
  await db.delete(schema.apiTokens).where(and(eq(schema.apiTokens.userId, user.id), eq(schema.apiTokens.kind, kind)));
  return c.body(null, 204);
});
