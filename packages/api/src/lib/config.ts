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
 * True only on readthicket.com, thicket's own hosted service. Some things
 * belong to that service alone — its landing page, public sign up, account
 * email and password reset — because a self-hoster runs their own users.
 * Off unless set, so a copy of thicket never turns them on by accident.
 */
export const HOSTED = env("HOSTED") === "true";
/**
 * Every account must have an email, so password reset always works. Today
 * that's readthicket.com alone; self-hosted copies don't ask for email.
 */
export const EMAIL_REQUIRED = HOSTED;
/**
 * Outgoing mail: smtp://user:pass@host:587 (or smtps:// for port 465), from
 * whichever email provider you use. Required when EMAIL_REQUIRED; thicket
 * won't start without it. In dev, point it at a local mail catcher (see
 * docs/testing.md). See lib/mail.ts.
 */
export const SMTP_URL = env("SMTP_URL");
/** The From line on every message. */
export const MAIL_FROM = env("MAIL_FROM") ?? "thicket <no-reply@readthicket.com>";

/**
 * "Send feedback" (issue #153, readthicket.com only; see lib/feedback.ts).
 * What people send is filed as an issue in a private GitHub repository, and
 * GitHub tells the people who watch it.
 *
 * FEEDBACK_REPO is that repository, as owner/name. It is private: issues
 * carry people's own words.
 * GITHUB_TOKEN can read and write issues on it. Until it is set, feedback is
 * saved and waits (the log says so at boot); nothing is lost.
 *
 * ANTHROPIC_API_KEY is optional. With it, Claude reads each new piece of
 * feedback beside the open issues, and one that repeats an issue is added to
 * it as a comment. Without it, every piece of feedback is a new issue.
 */
export const FEEDBACK_REPO = env("FEEDBACK_REPO") ?? "christielenn/thicket-feedback";
export const GITHUB_TOKEN = env("GITHUB_TOKEN");
export const FEEDBACK_AI = !!env("ANTHROPIC_API_KEY");

/**
 * The Contact page (issue #159, readthicket.com only; see routes/contact.ts).
 * CONTACT_TO is the inbox its messages are emailed to. It is a setting and
 * not written here so the address stays out of the public code and never
 * appears on the site. Until it is set, the form tells people their message
 * couldn't be sent, and the log says why at boot.
 */
export const CONTACT_TO = env("CONTACT_TO");

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
