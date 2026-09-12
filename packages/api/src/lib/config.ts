/**
 * Runtime configuration: environment variables with defaults. Everything an
 * operator can set is listed here and mirrored in .env.example and
 * docs/DEPLOY.md. Instance-wide settings an admin changes at runtime
 * (sign-up policy) live in the instance_settings table; env values seed them.
 */
const env = (k: string) => process.env[k]?.trim() || undefined;

/** The address people reach this instance at. Required for cookies, invite links, and peer features. */
export const PUBLIC_URL = (env("PUBLIC_URL") ?? `http://localhost:${env("PORT") ?? 3000}`).replace(/\/+$/, "");
export const IS_HTTPS = PUBLIC_URL.startsWith("https://");
export const PORT = Number(env("PORT") ?? 3000);
/** Directory of the built web app to serve alongside the API. Unset = API only (Vite serves the web in dev). */
export const WEB_DIR = env("WEB_DIR");
/** "on" runs the feed fetcher in this process (default). "off" for a large instance that runs fetchers separately. */
export const SCHEDULER = (env("SCHEDULER") ?? "on") !== "off";
export const SCHEDULER_TICK_MS = Number(env("SCHEDULER_TICK_MS") ?? 15000);
export const FETCH_CONCURRENCY = Number(env("FETCH_CONCURRENCY") ?? 8);
export const TRACK_ACTIVITY = (env("TRACK_ACTIVITY") ?? "true") !== "false";
/** Seed value for the sign-up policy on a fresh instance: open | invite | closed. */
export const SIGNUPS_DEFAULT = (env("SIGNUPS") as "open" | "invite" | "closed" | undefined) ?? "invite";
export const INSTANCE_NAME = env("INSTANCE_NAME") ?? new URL(PUBLIC_URL).hostname;

/**
 * Retention windows, in days. 0 disables a window entirely.
 *
 * Posts default to OFF: a feed serves a window, not an archive, so a post we
 * delete is usually unrecoverable — thicket routinely holds more history than
 * the feed it came from. Turn it on only if the storage is worth more than the
 * archive. The logs default to 90 days because nothing is lost by forgetting
 * them, and the fetch log otherwise outgrows the posts it is logging.
 * See lib/retention.ts.
 */
export const RETAIN_ITEMS_DAYS = Number(env("RETAIN_ITEMS_DAYS") ?? 0);
export const RETAIN_FETCH_LOG_DAYS = Number(env("RETAIN_FETCH_LOG_DAYS") ?? 90);
export const RETAIN_EVENTS_DAYS = Number(env("RETAIN_EVENTS_DAYS") ?? 90);
