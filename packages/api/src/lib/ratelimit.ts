/**
 * Rate limiting for the endpoints that guess: login and sign-up.
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

/** Count one attempt against a key. `ok: false` once the window is used up. */
export function hit(key: string, { limit, windowMs }: Limit): { ok: boolean; retryAfterS: number } {
  const now = Date.now();
  const w = windows.get(key);
  if (!w || w.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterS: 0 };
  }
  w.count++;
  if (w.count > limit) return { ok: false, retryAfterS: Math.max(1, Math.ceil((w.resetAt - now) / 1000)) };
  return { ok: true, retryAfterS: 0 };
}

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
};

/** The 429 body, shaped like every other auth error so the web client renders it unchanged. */
export function tooMany(c: Context, retryAfterS: number, message: string) {
  c.header("retry-after", String(retryAfterS));
  const mins = Math.ceil(retryAfterS / 60);
  return c.json({ error: `${message} Try again in ${mins === 1 ? "a minute" : `${mins} minutes`}.` }, 429);
}
