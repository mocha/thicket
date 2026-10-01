/**
 * The import page's three steps (lib/importer.ts): read a file or a link into
 * groups, check the feeds thicket hasn't seen, make the chosen collections.
 */
import { Hono } from "hono";
import { currentUser } from "../lib/user.js";
import { LIMITS, hit, tooManyFor } from "../lib/ratelimit.js";
import { CHECK_BATCH, ImportError, checkFeeds, commitImport, fetchOpml, readImport, type CommitGroup } from "../lib/importer.js";

export const imports = new Hono();

/** An OPML file is kilobytes; the largest real export we have seen (813 feeds) is 150 KB. */
const MAX_FILE_BYTES = 5 * 1024 * 1024;

const fail = (err: unknown) => {
  if (err instanceof ImportError) return { error: err.message };
  throw err;
};

/** Body: the OPML document itself, or JSON `{ url }` to fetch one by link. */
imports.post("/read", async (c) => {
  const user = currentUser(c);
  try {
    let text: string;
    if ((c.req.header("content-type") ?? "").includes("application/json")) {
      const body = await c.req.json<{ url?: string }>().catch(() => ({} as { url?: string }));
      const rl = hit(`import-link:${user.id}`, LIMITS.importLink);
      if (!rl.ok) return tooManyFor(c, rl.retryAfterS, "That’s a lot of links in an hour. Try again later.");
      text = await fetchOpml(body.url ?? "");
    } else {
      text = await c.req.text();
    }
    if (!text.trim()) return c.json({ error: "That file is empty." }, 400);
    if (text.length > MAX_FILE_BYTES) return c.json({ error: "That file is too large to be a list of feeds." }, 400);
    return c.json(await readImport(user.id, text));
  } catch (err) {
    return c.json(fail(err), 400);
  }
});

/**
 * Body: `{ urls }`, at most CHECK_BATCH. Every one is a fetch of an address
 * someone else supplied, so each one is counted (LIMITS.importCheck): room
 * for a real import of a few hundred feeds, a wall for anything else.
 */
imports.post("/check", async (c) => {
  const user = currentUser(c);
  const body = await c.req.json<{ urls?: unknown }>().catch(() => ({} as { urls?: unknown }));
  const urls = Array.isArray(body.urls) ? body.urls.filter((u): u is string => typeof u === "string").slice(0, CHECK_BATCH) : [];
  if (!urls.length) return c.json({ error: "urls is required" }, 400);
  const rl = hit(`import-check:${user.id}`, LIMITS.importCheck, urls.length);
  if (!rl.ok) return tooManyFor(c, rl.retryAfterS, "That’s a lot of checking in an hour. Try again later.");
  return c.json({ results: await checkFeeds(urls) });
});

/** Body: `{ groups: [{ name, feeds: [{ url, title }] }] }`, the groups the person kept. */
imports.post("/commit", async (c) => {
  const user = currentUser(c);
  const body = await c.req.json<{ groups?: CommitGroup[] }>().catch(() => ({} as { groups?: CommitGroup[] }));
  if (!Array.isArray(body.groups) || !body.groups.length) return c.json({ error: "Choose at least one folder to bring in." }, 400);
  try {
    return c.json(await commitImport(user, body.groups), 201);
  } catch (err) {
    return c.json(fail(err), 400);
  }
});
