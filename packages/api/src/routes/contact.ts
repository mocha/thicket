/**
 * The Contact page (issue #159, readthicket.com only): one verb, for anyone,
 * signed in or not. What they write is emailed to our inbox (CONTACT_TO) with
 * their address as the reply address, so answering is pressing Reply.
 *
 * Nothing is saved: the email is the record. So the answer waits for the
 * mail to go out, and when it doesn't, the person is told, and still has
 * their words in the form to send again. The real reason is in the log.
 */
import { Hono } from "hono";
import { CONTACT_TO, HOSTED } from "../lib/config.js";
import { cleanEmail, looksLikeEmail, send } from "../lib/mail.js";
import { LIMITS, MAX_LENGTH, clientKey, hit, tooMany } from "../lib/ratelimit.js";

export const contact = new Hono();

/** One line, so a name can't add lines of its own to the email's subject or headers. */
const oneLine = (raw: unknown) => (typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "");

/**
 * Send a message. Body: { name?, email, message, website? }. `website` is a
 * box people never see; only a script fills it in, and what it sends is
 * answered as if it went and dropped.
 */
contact.post("/", async (c) => {
  if (!HOSTED) return c.json({ error: "not found" }, 404);
  type Body = { name?: unknown; email?: unknown; message?: unknown; website?: unknown };
  const payload = await c.req.json<Body>().catch(() => ({} as Body));
  if (typeof payload.website === "string" && payload.website.trim()) return c.json({ ok: true }, 201);
  const name = oneLine(payload.name);
  const email = cleanEmail(payload.email);
  const message = typeof payload.message === "string" ? payload.message.trim() : "";
  if (!looksLikeEmail(email)) return c.json({ error: "Enter your email, so we can write back.", field: "email" }, 400);
  if (!message) return c.json({ error: "Write a message first.", field: "message" }, 400);
  if (message.length > MAX_LENGTH.contact) return c.json({ error: `That’s longer than ${MAX_LENGTH.contact.toLocaleString("en-US")} characters. Trim it a little, or send it in two parts.`, field: "message" }, 400);
  if (name.length > MAX_LENGTH.contactName) return c.json({ error: "That name is too long.", field: "name" }, 400);
  const pace = hit(`contact:${clientKey(c)}`, LIMITS.contactAddress);
  if (!pace.ok) return tooMany(c, pace.retryAfterS, "That’s a lot of messages from here.");
  const failed = () => c.json({ error: "We couldn’t send your message. Try again in a little while." }, 502);
  if (!CONTACT_TO) {
    console.error("[contact] a message couldn’t be sent: CONTACT_TO is unset. See docs/DEPLOY.md.");
    return failed();
  }
  const user = c.get("user") as { handle: string } | null | undefined;
  const from = [name || "Someone", `<${email}>`, user ? `(signed in as @${user.handle})` : null].filter(Boolean).join(" ");
  const sent = await send({ to: CONTACT_TO, replyTo: email, subject: `thicket contact: ${name || email}`, text: `${message}\n\n— ${from}\nSent from the Contact page. Reply to this email to answer them.` });
  return sent ? c.json({ ok: true }, 201) : failed();
});
