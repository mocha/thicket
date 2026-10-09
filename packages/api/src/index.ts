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
import { Hono, type MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { proxy } from "hono/proxy";
import { logger } from "hono/logger";
import { ROUTERS } from "./routes/index.js";
import { startScheduler } from "./feeds/scheduler.js";
import { attachUser, pruneSessions } from "./lib/auth.js";
import { pruneEmailTokens } from "./lib/email-tokens.js";
import { startRetention } from "./lib/retention.js";
import { startFeedbackRetry } from "./lib/feedback.js";
import { ensureAdmin, publicStatus } from "./lib/instance.js";
import { runMigrations } from "./db/migrate.js";
import { pool } from "./db/client.js";
import { headForPath } from "./lib/meta.js";
import { openApiDocument } from "./lib/openapi.js";
import { EMAIL_REQUIRED, FETCH_CONCURRENCY, PORT, PUBLIC_URL, SCHEDULER, SCHEDULER_TICK_MS, SITE_URL, SMTP_URL, TRACK_ACTIVITY, WEB_DIR } from "./lib/config.js";

// Every account has an email so it can reset its password; without mail, nobody could.
if (EMAIL_REQUIRED && !SMTP_URL) {
  console.error("[mail] SMTP_URL is unset, but this instance requires email (HOSTED=true). Set SMTP_URL; see docs/DEPLOY.md.");
  process.exit(1);
}

try {
  await runMigrations();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  await pool.end();
  process.exit(1);
}
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
startFeedbackRetry();

app.get("/api/health", async (c) => c.json({
  ok: true, instance: await publicStatus(), signedIn: !!c.get("user"), tracking: TRACK_ACTIVITY, scheduler: scheduler?.stats ?? "off",
  // What the proxies in front tell us about the client. Diagnostic for rate limiting keyed on the wrong hop.
  via: { forwardedFor: c.req.header("x-forwarded-for") ?? null, realIp: c.req.header("x-real-ip") ?? null, cfConnectingIp: c.req.header("cf-connecting-ip") ?? null, proto: c.req.header("x-forwarded-proto") ?? null, host: c.req.header("x-forwarded-host") ?? c.req.header("host") ?? null },
}));
// What an API token can do, described for applications and assistants (lib/openapi.ts). Readable by anyone.
app.get("/api/openapi.json", (c) => c.json(openApiDocument(PUBLIC_URL), 200, { "cache-control": "public, max-age=300" }));
// Where the landing page was reviewed before it went live. Links to it were shared.
app.get("/preview/landing", (c) => c.redirect("/", 301));
app.notFound((c) => (c.req.path.startsWith("/api/") ? c.json({ error: "not found" }, 404) : c.text("not found", 404)));

/**
 * readthicket.com's own site (SITE_URL): what it serves, by path. "/" is its
 * landing page, then About and Contact; /_site/ holds its built files (the
 * app's own are under /_app/). New pages there are added here too, and
 * Contact's form sends to /contact/send. If the site can't be reached, "/"
 * falls through to the app's own front page, which sends people into the app.
 */
const SITE_PATHS = ["/", "/about", "/contact", "/_site/*"];
const SITE_POSTS = ["/contact/send"];
if (SITE_URL) {
  const toSite: MiddlewareHandler = async (c, next) => {
    const url = new URL(c.req.url);
    try {
      return await proxy(`${SITE_URL}${url.pathname}${url.search}`, {
        raw: c.req.raw,
        headers: { ...c.req.header(), host: undefined, "x-forwarded-host": url.host, "x-forwarded-proto": c.req.header("x-forwarded-proto") ?? url.protocol.replace(":", "") },
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      console.error(`[site] ${c.req.method} ${url.pathname}: ${err instanceof Error ? err.message : err}`);
      if (url.pathname !== "/" || c.req.method === "POST") return c.text("unavailable", 502);
      await next();
    }
  };
  app.on(["GET", "HEAD"], SITE_PATHS, toSite);
  app.on("POST", SITE_POSTS, toSite);
}

if (WEB_DIR) {
  // Hashed build assets are immutable; everything else (index.html, manifest, icons) is revalidated.
  // index: none, so "/" falls through to the head-injecting fallback below instead of the raw file.
  app.use("/*", serveStatic({
    root: WEB_DIR,
    index: "__no_index__",
    onFound: (path, c) => c.header("cache-control", path.includes("/_app/immutable/") ? "public, max-age=31536000, immutable" : "public, max-age=0, must-revalidate"),
  }));
  // The main list was called Everything until issue #173. Forward its old address here too, not only in the
  // browser, so link previews and search engines see the move. (The web app's own redirect covers dev.)
  app.get("/everything", (c) => c.redirect("/new-posts" + new URL(c.req.url).search, 308));
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
