/**
 * Give an account a set of bookmarks so the Bookmarks section has a count and
 * the /bookmarks page (and Recent activity) has something to show. Each
 * bookmark is also its own activity entry, so seeding two dozen pushes Recent
 * activity past the point where its "Show more" appears.
 *
 *   pnpm --filter @thicket/api tsx --env-file=../../.env src/scripts/seed-bookmarks.ts [handle] [count]
 *
 * Default handle: christie, else the first user. Default count: 24. Idempotent:
 * a URL the account already saved is left alone (unique on user + url).
 */
import { db, pool, schema } from "../db/client.js";
import { eq, sql } from "drizzle-orm";

const handle = process.argv[2] ?? "christie";
const count = Number(process.argv[3] ?? 24);

async function main() {
  const [account] = await db.select().from(schema.users).where(eq(schema.users.handle, handle));
  if (!account) throw new Error(`no user @${handle}; sign up first`);

  const items = await db.execute<{ id: number; url: string | null; title: string | null; feedId: number; siteTitle: string | null; publishedAt: Date | null }>(sql`
    select i.id, i.url, i.title, i.feed_id as "feedId", f.title as "siteTitle", i.published_at as "publishedAt"
    from items i join feeds f on f.id = i.feed_id
    where i.url is not null
    order by i.id desc
    limit ${count}
  `);

  if (items.rows.length === 0) {
    console.log("No posts with a link in the database — run `pnpm seed` and let a few feeds fetch, then run this again.");
    return;
  }

  let added = 0;
  for (let i = 0; i < items.rows.length; i++) {
    const it = items.rows[i];
    // Spread saved times over roughly the last month so they interleave with notes.
    const savedAt = new Date(Date.now() - Math.round(i * 1.3 * 86_400_000) - 3_600_000);
    const res = await db
      .insert(schema.bookmarks)
      .values({
        userId: account.id,
        itemId: it.id,
        feedId: it.feedId,
        url: it.url!,
        title: it.title,
        siteTitle: it.siteTitle,
        publishedAt: it.publishedAt ? new Date(it.publishedAt) : null,
        savedAt,
      })
      .onConflictDoNothing()
      .returning({ id: schema.bookmarks.id });
    if (res.length) added++;
  }

  const [{ total }] = (await db.execute<{ total: number }>(sql`select count(*)::int as total from bookmarks where user_id = ${account.id}`)).rows;
  console.log(`@${account.handle}: added ${added} bookmark(s); ${total} total now.`);
}

main()
  .then(() => pool.end())
  .catch((e) => {
    console.error(e);
    return pool.end().then(() => process.exit(1));
  });
