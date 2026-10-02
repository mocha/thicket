/**
 * "Send feedback" (issue #153): one verb, for someone signed in on
 * readthicket.com. It saves what they wrote and answers at once; filing it
 * in the private issue tracker follows on its own (lib/feedback.ts).
 */
import { Hono } from "hono";
import { db, schema } from "../db/client.js";
import { currentUser } from "../lib/user.js";
import { HOSTED } from "../lib/config.js";
import { fileFeedback } from "../lib/feedback.js";
import { LIMITS, MAX_LENGTH, hit, tooManyFor } from "../lib/ratelimit.js";

export const feedback = new Hono();

/**
 * Send feedback. Body: { body, page?, includeHandle? }, where page is the path
 * they were on. Who sent it is kept only when includeHandle is true: without
 * it the feedback is saved, and filed, with no name attached.
 */
feedback.post("/", async (c) => {
  if (!HOSTED) return c.json({ error: "not found" }, 404);
  const user = currentUser(c);
  type Body = { body?: unknown; page?: unknown; includeHandle?: unknown };
  const payload = await c.req.json<Body>().catch(() => ({} as Body));
  const body = typeof payload.body === "string" ? payload.body.trim() : "";
  if (!body) return c.json({ error: "Write something first." }, 400);
  if (body.length > MAX_LENGTH.feedback) return c.json({ error: `That’s longer than ${MAX_LENGTH.feedback.toLocaleString("en-US")} characters. Trim it a little, or send it in two parts.` }, 400);
  const pace = hit(`feedback:${user.id}`, LIMITS.feedbackPerDay);
  if (!pace.ok) return tooManyFor(c, pace.retryAfterS, "That’s a lot of feedback for one day. Send the rest tomorrow.");
  const page = typeof payload.page === "string" ? payload.page.slice(0, 300) : null;
  const [row] = await db.insert(schema.feedback).values({ userId: payload.includeHandle === true ? user.id : null, body, page, userAgent: c.req.header("user-agent")?.slice(0, 300) ?? null }).returning({ id: schema.feedback.id });
  void fileFeedback(row.id);
  return c.json({ ok: true }, 201);
});
