/**
 * The one process. Boots in this order: migrate the database, make sure
 * someone is admin, mount the API, serve the built web app if WEB_DIR is set,
 * start the feed scheduler unless told not to. In dev, Vite serves the web and
 * proxies /api here, so WEB_DIR is unset.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { ROUTERS } from "./routes/index.js";
import { startScheduler } from "./feeds/scheduler.js";
import { attachUser, pruneSessions } from "./lib/auth.js";
import { pruneEmailTokens } from "./lib/email-tokens.js";
import { startRetention } from "./lib/retention.js";
import { ensureAdmin, publicStatus } from "./lib/instance.js";
import { runMigrations } from "./db/migrate.js";
import { headForPath } from "./lib/meta.js";
import { EMAIL_REQUIRED, FETCH_CONCURRENCY, PORT, PUBLIC_URL, SCHEDULER, SCHEDULER_TICK_MS, SMTP_URL, TRACK_ACTIVITY, WEB_DIR } from "./lib/config.js";

// Every account has an email so it can reset its password; without mail, nobody could.
if (EMAIL_REQUIRED && !SMTP_URL) {
  console.error("[mail] SMTP_URL is unset, but this instance requires email (HOSTED=true). Set SMTP_URL; see docs/DEPLOY.md.");
  process.exit(1);
}

await runMigrations();
await ensureAdmin();

const app = new Hono();
app.use(logger());
// Same-origin in production (the API serves the web). In dev Vite proxies, so
// credentials must be allowed for the cookie to ride along.
app.use("/api/*", cors({ origin: (o) => o, credentials: true }));
app.use("/api/*", attachUser);

for (const [base, router] of ROUTERS) app.route(base, router);

const scheduler = SCHEDULER
  ? startScheduler({ tickMs: SCHEDULER_TICK_MS, concurrency: FETCH_CONCURRENCY, log: (m) => console.log(`[fetch] ${m}`) })
  : null;
setInterval(() => void pruneSessions().catch(() => {}), 3600_000).unref();
setInterval(() => void pruneEmailTokens().catch(() => {}), 3600_000).unref();
startRetention();

app.get("/api/health", async (c) => c.json({
  ok: true, instance: await publicStatus(), signedIn: !!c.get("user"), tracking: TRACK_ACTIVITY, scheduler: scheduler?.stats ?? "off",
  // What the proxies in front tell us about the client. Diagnostic for rate limiting keyed on the wrong hop.
  via: { forwardedFor: c.req.header("x-forwarded-for") ?? null, realIp: c.req.header("x-real-ip") ?? null, cfConnectingIp: c.req.header("cf-connecting-ip") ?? null, proto: c.req.header("x-forwarded-proto") ?? null, host: c.req.header("x-forwarded-host") ?? c.req.header("host") ?? null },
}));
app.notFound((c) => (c.req.path.startsWith("/api/") ? c.json({ error: "not found" }, 404) : c.text("not found", 404)));

if (WEB_DIR) {
  // Hashed build assets are immutable; everything else (index.html, manifest, icons) is revalidated.
  // index: none, so "/" falls through to the head-injecting fallback below instead of the raw file.
  app.use("/*", serveStatic({
    root: WEB_DIR,
    index: "__no_index__",
    onFound: (path, c) => c.header("cache-control", path.includes("/_app/immutable/") ? "public, max-age=31536000, immutable" : "public, max-age=0, must-revalidate"),
  }));
  // SPA fallback: any other path is a client route. Public pages get a
  // server-rendered <head> (title, Open Graph, OPML link) so shared links unfurl.
  const index = readFileSync(join(WEB_DIR, "index.html"), "utf8");
  const HEAD_OPEN = /<head>\s*/;
  app.get("*", async (c) => {
    if (c.req.path.startsWith("/api/")) return c.notFound();
    const head = await headForPath(c.req.path);
    return c.html(index.replace(HEAD_OPEN, (m) => `${m}${head}\n\t\t`), 200, { "cache-control": "no-cache" });
  });
}

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`thicket listening on :${PORT}, public URL ${PUBLIC_URL}${WEB_DIR ? "" : " (API only; Vite serves the web in dev)"}${SCHEDULER ? "" : ", scheduler off"}`);
});
