/**
 * Product analytics. A necessary evil for now, gated twice: TRACK_ACTIVITY at
 * the instance level, and each user's own opt-out (users.track_activity).
 * When off, the endpoint accepts and discards so clients never need to know.
 * Anonymous requests are always discarded: no visitor tracking.
 */
import { Hono } from "hono";
import { db, schema } from "../db/client.js";

export const events = new Hono();

events.post("/", async (c) => {
  const body = await c.req.json<{ kind: string; payload?: Record<string, unknown> }>().catch(() => null);
  if (!body?.kind) return c.json({ error: "kind is required" }, 400);
  const user = c.get("user");
  if (!user || !user.trackActivity) return c.body(null, 204);
  await db.insert(schema.events).values({ userId: user.id, kind: body.kind.slice(0, 64), payload: body.payload ?? {} });
  return c.body(null, 204);
});
