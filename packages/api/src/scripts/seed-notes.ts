/**
 * Give an account a handful of notes so the profile's Bookmarks section has
 * something to show. Notes attach to posts that already exist, so run the
 * feed seed first (`pnpm seed`) and let a few items arrive.
 *
 *   pnpm --filter @thicket/api tsx --env-file=../../.env src/scripts/seed-notes.ts [handle]
 *
 * Default handle: christielenn, else the first user. A note is part of a
 * bookmark, so each noted post is saved too. Idempotent: a post the account
 * already has a note on is left alone.
 */
import { db, pool, schema } from "../db/client.js";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { snapshotOfItem } from "../lib/bookmarks.js";

const handle = process.argv[2] ?? "christielenn";

/** A note and how long ago it was written, newest first. */
const NOTES = [
  { body: "This is the clearest explanation of the idea I've read. Sending it to the whole team.", daysAgo: 1 },
  { body: "Disagree with the framing in the middle, but the opening argument is worth the read on its own.", daysAgo: 3 },
  { body: "Bookmarking the approach here — want to try it on the onboarding flow next quarter.", daysAgo: 6 },
  { body: "Short, and it earns every sentence. Rare.", daysAgo: 9 },
  { body: "The footnote about caching is the actual insight; the headline undersells it.", daysAgo: 14 },
  { body: "Came back to this a second time and it holds up. The examples are what make it land.", daysAgo: 20 },
];

async function main() {
  const [account] = handle
    ? await db.select().from(schema.users).where(eq(schema.users.handle, handle))
    : await db.select().from(schema.users).orderBy(schema.users.id).limit(1);
  if (!account) throw new Error(`no user @${handle}; sign up first`);

  const items = await db
    .select({ id: schema.items.id, title: schema.items.title })
    .from(schema.items)
    .orderBy(sql`${schema.items.id} desc`)
    .limit(NOTES.length);

  if (items.length === 0) {
    console.log("No posts in the database yet — run `pnpm seed` and let the scheduler fetch a few feeds, then run this again.");
    return;
  }

  let added = 0;
  for (let i = 0; i < items.length && i < NOTES.length; i++) {
    const note = NOTES[i];
    const at = new Date(Date.now() - note.daysAgo * 86_400_000);
    const snap = await snapshotOfItem(account.id, items[i].id);
    if (!snap) continue;
    const res = await db
      .insert(schema.bookmarks)
      .values({ ...snap, savedAt: at, note: note.body, noteCreatedAt: at, noteUpdatedAt: at })
      .onConflictDoUpdate({
        target: [schema.bookmarks.userId, schema.bookmarks.url],
        set: { note: note.body, noteCreatedAt: at, noteUpdatedAt: at },
        setWhere: sql`${schema.bookmarks.note} is null`,
      })
      .returning({ id: schema.bookmarks.id });
    if (res.length) added++;
  }

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(schema.bookmarks)
    .where(and(eq(schema.bookmarks.userId, account.id), isNotNull(schema.bookmarks.note)));
  console.log(`@${account.handle}: added ${added} note(s); ${total} total now.`);
}

main()
  .then(() => pool.end())
  .catch((e) => {
    console.error(e);
    return pool.end().then(() => process.exit(1));
  });
