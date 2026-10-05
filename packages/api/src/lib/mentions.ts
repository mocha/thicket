/**
 * @mentions in notes (issue #184): `@handle` written anywhere in a note's
 * Markdown names that person.
 *
 * Nothing about a mention is stored. A note's text is the record, so editing
 * a mention out of a note, or deleting the note, takes the mention with it,
 * the same way activity and notifications are derived rather than logged. Two
 * questions get asked of the text, both here so they agree on what counts as a
 * mention:
 *
 *   which handles does this note mention?   (mentionsJsonSql, mentionedHandles)
 *       for drawing them as links to the profile, when that person exists
 *   does this note mention me?              (mentionsHandleSql)
 *       for Notifications, over notes written in the last few weeks only
 *
 * A mention starts at an `@` that does not follow a letter, digit, `_`, `@`,
 * `/`, `.` or `-`, so an email address (me@example.com) or a link
 * (https://example.com/@someone) is not one. It ends where a handle can't go
 * on: handles are 2–30 of [a-z0-9_-] (lib/auth.ts), so "@ana," and "@ana." both
 * mention ana. Case doesn't matter; handles are stored lowercase.
 *
 * The web app draws the links with the same rule (web/src/lib/markdown.ts).
 */
import { sql, type SQL } from "drizzle-orm";
import { db } from "../db/client.js";

/** What may come just before the `@`: anything but these. */
const BEFORE = "[^A-Za-z0-9_@/.-]";
/** A handle as written in a note, any case. */
const HANDLE = "[A-Za-z0-9][A-Za-z0-9_-]{1,29}";

const MENTION = new RegExp(`(?:^|${BEFORE})@(${HANDLE})(?![A-Za-z0-9_-])`, "g");

/** The handles a note's text mentions, lowercase, each once, in the order written. */
export function mentionedHandles(body: string): string[] {
  const out = new Set<string>();
  for (const m of body.matchAll(MENTION)) out.add(m[1].toLowerCase());
  return [...out];
}

/**
 * The handles of real people that note column `note` mentions, as a jsonb
 * array. A note with no `@` at all skips the work. Each candidate is looked up
 * by the handle's unique index, so this stays cheap under every note in a list.
 * Postgres's regular expressions have no lookahead, so the end of a handle is
 * found by the greedy match instead: it takes every handle character there is.
 */
export const mentionsJsonSql = (note: string): string =>
  `(case when strpos(${note}, '@') = 0 then '[]'::jsonb else coalesce((
     select jsonb_agg(mu.handle order by mu.handle) from users mu
     where mu.handle = any(array(select lower((regexp_matches(${note}, '(?:^|${BEFORE})@(${HANDLE})', 'g'))[1])))
   ), '[]'::jsonb) end)`;

/** Does note column `note` mention this handle? The handle is a stored one: lowercase, nothing a pattern would read as syntax. */
export const mentionsHandleSql = (note: SQL, handle: string): SQL =>
  sql`${note} ~* ${`(^|${BEFORE})@${handle}($|[^A-Za-z0-9_-])`}`;

/** The people a note just written mentions, for the answer to writing it: the same list noteJson carries. */
export async function mentionsOf(body: string): Promise<string[]> {
  const r = await db.execute<{ m: string[] }>(sql`select ${sql.raw(mentionsJsonSql("x.note"))} as m from (select ${body}::text as note) x`);
  return r.rows[0]?.m ?? [];
}
