/**
 * API tokens (issue #140): what one looks like, and what one may do.
 *
 * A token is a credential a person hands to their own scripts and assistants.
 * It works on the same API the web app uses, as `Authorization: Bearer …`,
 * with two differences from a browser session, both decided here in one place
 * and enforced by the auth middleware (lib/auth.ts) before any route runs:
 *
 * 1. **A read-only token only reads.** Anything that is not a GET is refused,
 *    except the few reads that happen to be sent as a POST (READS_BY_POST).
 * 2. **Some things no token may do, whatever its kind** (NEVER). They are the
 *    ones that decide who holds the account, and the ones that are the web
 *    app's own business. A token that leaks should cost its owner their
 *    reading list at worst, never the account.
 *
 * Everything else a token can reach is listed in the published description
 * (lib/openapi.ts); a test fails if the two drift apart.
 *
 * Pure: no database, so it is tested on its own (token-access.test.ts).
 */
import { createHash, randomBytes } from "node:crypto";

export type TokenKind = "read" | "full";
export const TOKEN_KINDS: TokenKind[] = ["read", "full"];

/** Recognisable on sight, by a person and by a secret scanner: thk_ro_… reads, thk_rw_… reads and writes. */
const PREFIX: Record<TokenKind, string> = { read: "thk_ro_", full: "thk_rw_" };

/** A new token: its prefix, then 32 random bytes (256 bits) as 43 URL-safe characters. */
export function newToken(kind: TokenKind): string {
  return PREFIX[kind] + randomBytes(32).toString("base64url");
}

/** Whether this could be one of ours at all, before asking the database. */
export function looksLikeToken(raw: string): boolean {
  return /^thk_r[ow]_[A-Za-z0-9_-]{43}$/.test(raw);
}

/** What a request is looked up by. */
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** The token in an Authorization header, or null when the header is absent or is some other scheme. */
export function bearerOf(header: string | undefined): string | null {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header ?? "");
  return m ? m[1] : null;
}

type Rule = { method?: string; path: RegExp; why: string };

/**
 * What no token may reach, whatever its kind. Checked against the request's
 * method and path; a rule with no method covers every method.
 */
export const NEVER: Rule[] = [
  { path: /^\/api\/admin(\/|$)/, why: "running the instance" },
  { path: /^\/api\/tokens(\/|$)/, why: "managing API tokens" },
  // Signing up, in and out, the password, the email address, deleting the
  // account, and the profile and sharing settings. Reading who I am is fine.
  { method: "GET", path: /^\/api\/auth\/(me|status)$/, why: "" },
  { path: /^\/api\/auth(\/|$)/, why: "account and sign-in settings" },
  // My picture is part of my profile. Reading anyone's picture is fine.
  { method: "GET", path: /^\/api\/users\//, why: "" },
  { path: /^\/api\/users(\/|$)/, why: "profile settings" },
  // The import page is a conversation with a person, and each call has thicket fetch many addresses.
  { path: /^\/api\/import(\/|$)/, why: "the import page" },
  // The web app's own usage log.
  { path: /^\/api\/events(\/|$)/, why: "the web app’s usage log" },
];

/** Reads that are sent as a POST because they carry a body. A read-only token may make them. */
export const READS_BY_POST: RegExp[] = [/^\/api\/marks\/counts$/];

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

export type Verdict = { ok: true } | { ok: false; error: string };

/** May a token of this kind make this request? The answer for every route, in one place. */
export function tokenMay(kind: TokenKind, method: string, path: string): Verdict {
  const m = method.toUpperCase();
  // Read the path as loosely as anything downstream might (decoded, doubled
  // slashes folded, any case), so a rule can only ever catch more than the
  // router does, never less.
  let decoded = path;
  try { decoded = decodeURIComponent(path); } catch { /* not valid encoding: judge it as written */ }
  const clean = decoded.replace(/\/{2,}/g, "/").replace(/\/+$/, "").toLowerCase() || "/";
  // First rule that matches decides. One with no reason is an exception that lets the request through.
  const rule = NEVER.find((r) => r.path.test(clean) && (!r.method || r.method === m || (r.method === "GET" && SAFE.has(m))));
  if (rule?.why) return { ok: false, error: `API tokens can’t be used for ${rule.why}. Sign in to thicket in a browser to do that.` };
  if (kind === "read" && !SAFE.has(m) && !(m === "POST" && READS_BY_POST.some((p) => p.test(clean)))) {
    return { ok: false, error: "This is a read-only token: it can read, but not change anything. Use a full access token for that." };
  }
  return { ok: true };
}
