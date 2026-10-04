/**
 * Notifications (issue #184): the list, the number in the sidebar bubble, and
 * "I've looked". The list is derived on every request from follows, bookmarks
 * and notes (lib/notifications.ts); the only thing stored is the time I last
 * looked, one column on my account, so it is the same on every device.
 *
 * Reading the list does not mark it seen. The page reads, shows what was new
 * highlighted, then says so with POST /seen, passing the `asOf` the list came
 * with: anything that arrived between the two is still new next time, rather
 * than being marked seen without ever having been shown.
 */
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { currentUser } from "../lib/user.js";
import { notificationsFor } from "../lib/notifications.js";

export const notifications = new Hono();

notifications.get("/", async (c) => {
  const me = currentUser(c);
  const r = await notificationsFor(me);
  return c.json({ items: r.items, count: r.count, more: r.more, seenAt: r.seenAt, asOf: r.asOf });
});

/** How many are new, for the bubble. Counted the same way as the list, up to 100 (`more` past that). */
notifications.get("/count", async (c) => {
  const me = currentUser(c);
  const r = await notificationsFor(me);
  return c.json({ count: r.count, more: r.more });
});

/**
 * I've seen everything up to `upTo` (the list's `asOf`), or up to now when it
 * is absent. Seen only ever moves forward, and never past now.
 */
notifications.post("/seen", async (c) => {
  const me = currentUser(c);
  const body = await c.req.json<{ upTo?: string }>().catch(() => ({} as { upTo?: string }));
  const upTo = body.upTo && !Number.isNaN(Date.parse(body.upTo)) ? new Date(body.upTo).toISOString() : null;
  const [row] = (await db.execute<{ seenAt: Date }>(sql`
    update users set notifications_seen_at = greatest(notifications_seen_at, least(coalesce(${upTo}::timestamptz, now()), now()))
    where id = ${me.id} returning notifications_seen_at as "seenAt"
  `)).rows;
  return c.json({ seenAt: new Date(row.seenAt).toISOString() });
});
