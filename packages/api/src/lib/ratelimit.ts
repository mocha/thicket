/**
 * Every limit thicket puts on what an account or an address may do, in one
 * place so each can be tuned from evidence: how often (LIMITS) and how long
 * (MAX_LENGTH). It began with the endpoints that guess or send (login,
 * sign-up, and the ones that email someone) and now also covers saving
 * bookmarks, writing notes and the import page (issue #136), and requests
 * made with an API token (issue #140).
 *
 * In-process fixed windows in a Map. Deliberate shortcut, the same one the
 * scheduler makes: this instance is one process, so a shared store would be
 * ceremony. The upgrade path when there are several processes is to move
 * `hit()` behind Redis or a table; nothing else here changes.
 *
 * Why the handle limit matters more than the address limit: a proxy in front
 * of thicket may not pass the real client address. Behind a NAT hairpin or a
 * CDN it can arrive as the router's address, or the CDN's, so every user
 * shares one bucket — `/api/health` reports what actually turned up, which is
 * worth checking on a new deployment. Password guessing targets an account,
 * so the per-handle window is the real defense and is unaffected by any of
 * that; the per-address window is a looser backstop against handle
 * enumeration and sign-up floods, sized so a whole household behind one
 * address is not locked out by one person's typos.
 */
import type { Context } from "hono";

type Window = { count: number; resetAt: number };
const windows = new Map<string, Window>();

/** Drop expired windows so the Map can't grow without bound. */
setInterval(() => {
  const now = Date.now();
  for (const [k, w] of windows) if (w.resetAt <= now) windows.delete(k);
}, 60_000).unref();

export type Limit = { limit: number; windowMs: number };

/**
 * Count one attempt against a key. `ok: false` once the window is used up.
 * `cost` is for a request that stands for several things at once (a batch of
 * feeds to check): it counts as that many.
 */
export function hit(key: string, { limit, windowMs }: Limit, cost = 1): { ok: boolean; retryAfterS: number } {
  const now = Date.now();
  let w = windows.get(key);
  if (!w || w.resetAt <= now) {
    w = { count: 0, resetAt: now + windowMs };
    windows.set(key, w);
  }
  w.count += cost;
  if (w.count > limit) return { ok: false, retryAfterS: Math.max(1, Math.ceil((w.resetAt - now) / 1000)) };
  return { ok: true, retryAfterS: 0 };
}

/**
 * The same question asked of a rolling window: "how many in the last N
 * seconds", measured back from this moment and not from when a fixed window
 * happened to open. That is what API tokens are held to (issue #140), because
 * a fixed window lets a script send its whole allowance twice across the
 * boundary, and tells it to wait for the window instead of for its own
 * requests to age out.
 *
 * One key can be held to several limits at once (a short one against bursts,
 * a long one against steady automation). The request is counted only if every
 * limit allows it, so a refused request never uses up allowance, and
 * `retryAfterS` is exactly how long until one more would be allowed. `broke`
 * is which limit refused it, so the message can say.
 *
 * Kept as the times of recent requests, never more than the largest limit, so
 * the cost per key is bounded.
 */
const logs = new Map<string, number[]>();

export function hitRolling(key: string, limits: Limit[]): { ok: boolean; retryAfterS: number; broke: Limit | null } {
  const now = Date.now();
  const longest = Math.max(...limits.map((l) => l.windowMs));
  const log = (logs.get(key) ?? []).filter((t) => t > now - longest);
  let waitMs = 0;
  let broke: Limit | null = null;
  for (const l of limits) {
    const inWindow = log.filter((t) => t > now - l.windowMs);
    if (inWindow.length < l.limit) continue;
    // Room opens when enough of the oldest have aged out to leave limit - 1 behind.
    const wait = inWindow[inWindow.length - l.limit] + l.windowMs - now;
    if (wait > waitMs) { waitMs = wait; broke = l; }
  }
  if (!broke) log.push(now);
  logs.set(key, log);
  return broke ? { ok: false, retryAfterS: Math.max(1, Math.ceil(waitMs / 1000)), broke } : { ok: true, retryAfterS: 0, broke: null };
}

/** Drop logs with nothing recent in them. An hour is the longest rolling window there is. */
setInterval(() => {
  const cutoff = Date.now() - 3600_000;
  for (const [k, log] of logs) if (!log.length || log[log.length - 1] <= cutoff) logs.delete(k);
}, 60_000).unref();

/** Forget a key's window. Called on a successful login so one good password clears the slate. */
export function clear(key: string): void {
  windows.delete(key);
}

/**
 * Best guess at who is calling. Trusts proxy headers because thicket is always
 * behind one in production; a client that sets them directly can only spoof
 * itself into a *different* bucket, never out of the per-handle limit that
 * actually guards accounts.
 */
export function clientKey(c: Context): string {
  const xff = c.req.header("x-forwarded-for");
  const ip =
    c.req.header("cf-connecting-ip") ??
    c.req.header("x-real-ip") ??
    (xff ? xff.split(",")[0].trim() : null) ??
    "unknown";
  return ip || "unknown";
}

/** The windows themselves. Generous enough that a person who forgot their password never notices. */
export const LIMITS = {
  /** Per account. The one that stops password guessing. */
  loginHandle: { limit: 8, windowMs: 15 * 60_000 } satisfies Limit,
  /** Per address, across all accounts. Backstop against enumerating handles. */
  loginAddress: { limit: 40, windowMs: 15 * 60_000 } satisfies Limit,
  /** Per address. Sign-ups are rare and real; a flood is not. */
  signupAddress: { limit: 6, windowMs: 60 * 60_000 } satisfies Limit,
  /** Per address, across all accounts. "Forgot password" requests. */
  forgotAddress: { limit: 10, windowMs: 60 * 60_000 } satisfies Limit,
  /** Per handle or email asked about, so nobody can fill someone's inbox with reset links. Hit silently. */
  forgotTarget: { limit: 3, windowMs: 60 * 60_000 } satisfies Limit,
  /** Per account. Confirmation links sent from the Account page. */
  emailSend: { limit: 5, windowMs: 60 * 60_000 } satisfies Limit,

  // Safety limits on saving (issue #136). Bookmarks are unlimited and kept for
  // good, so these are what stops an account being used as free storage. They
  // are the same for every account and set far above anything a reader does.
  /**
   * Per account. Bookmarks saved in a day, by any route: from a post, from an
   * address, copied from someone's page, or put back with Undo. A heavy reader
   * saves tens a day.
   *
   * Counted here, in memory, and not by counting the day's rows: an Undo sends
   * its own saved-at time back from the browser, so a count of "rows saved
   * today" could be walked around by dating them last year. The cost is that a
   * restart starts the day again, which loosens the limit by one more day's
   * worth per restart and no further.
   */
  savesPerDay: { limit: 500, windowMs: 24 * 3600_000 } satisfies Limit,
  /** Per account. Notes written or rewritten in a day; every save of the editor is one. */
  noteWritesPerDay: { limit: 500, windowMs: 24 * 3600_000 } satisfies Limit,

  // The import page. Both make thicket fetch an address somebody else supplied.
  /** Per account. Lists of feeds fetched by link. */
  importLink: { limit: 30, windowMs: 60 * 60_000 } satisfies Limit,
  /**
   * Per account, counted per feed checked (a request checks up to eight). A
   * real import of a few hundred feeds, with its second tries, fits in one go.
   * Past it the import still works: the unchecked feeds are added and the
   * scheduler finds out about them at its own pace. It was 400 requests an
   * hour, which is 3,200 feeds.
   */
  importCheck: { limit: 600, windowMs: 60 * 60_000 } satisfies Limit,

  // API tokens (issue #140). Per token, rolling (hitRolling), and counted apart
  // from the browser session: reading in the web app never spends a token's
  // allowance, and a script never slows the web app down. Room for a person's
  // script or an assistant working through their reading; not for a crawler.
  /** Against bursts: no more than 10 requests in any 10 seconds. */
  tokenBurst: { limit: 10, windowMs: 10_000 } satisfies Limit,
  /** Against steady automation: no more than 120 requests in any hour. */
  tokenHourly: { limit: 120, windowMs: 60 * 60_000 } satisfies Limit,

  /**
   * Per account. Feedback sent in a day (issue #153). Each one becomes a
   * GitHub issue or comment and is read by Claude first, so this is what stops
   * one account flooding the tracker or running up a bill. Someone with a lot
   * to say fits.
   */
  feedbackPerDay: { limit: 10, windowMs: 24 * 3600_000 } satisfies Limit,
};

/**
 * How long each thing a browser sends for a bookmark may be, in characters.
 * Longer is refused with a message, never cut short. Each is set well above
 * the longest real one seen in feeds (in brackets), because putting a removed
 * bookmark back sends the post's own words back, and that must never fail.
 */
export const MAX_LENGTH = {
  /** A bookmark's address [653]. */
  url: 4_000,
  /** [2,469: some feeds put the whole post in the title.] */
  title: 5_000,
  /** [280: thicket trims a post's summary when it reads the feed.] */
  summary: 2_000,
  /** [1,725: a paper with every author listed.] */
  author: 5_000,
  /** The feed's name [143]. */
  siteTitle: 500,
  /**
   * The picture's address. Nearly all are short, but a few feeds put the
   * picture itself in the address (a data: URI) [382,274], and a bookmark of
   * one of those has to survive Undo.
   */
  imageUrl: 500_000,
  /** A note is a margin note, not a post. Two pages of a Word document, roughly. */
  note: 2_000,
  /** Feedback, the same room as a note. */
  feedback: 2_000,
};

/** The 429 body, shaped like every other auth error so the web client renders it unchanged. */
export function tooMany(c: Context, retryAfterS: number, message: string) {
  c.header("retry-after", String(retryAfterS));
  const mins = Math.ceil(retryAfterS / 60);
  return c.json({ error: `${message} Try again in ${mins === 1 ? "a minute" : `${mins} minutes`}.` }, 429);
}

/** The same, for a limit whose message already says when it ends: a day is too long to count in minutes. */
export function tooManyFor(c: Context, retryAfterS: number, message: string) {
  c.header("retry-after", String(retryAfterS));
  return c.json({ error: message, retryAfterS }, 429);
}
