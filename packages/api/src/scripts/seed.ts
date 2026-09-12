/**
 * Seed the instance with real feeds.
 *   pnpm seed                 → Ars Technica + 200 random Small Web feeds
 *   pnpm seed 1000            → Ars + 1000 random Small Web feeds
 *   pnpm seed 0               → Ars only
 *   pnpm seed 200 alice       → into a specific account (default: the first user)
 *
 * The Small Web list is a plain text file of one feed URL per line; point
 * SMALLWEB_TXT at your own. Those feeds are registered lazily and the
 * scheduler fetches them in the background, which doubles as a realistic
 * load test of the poller.
 */
import { readFileSync } from "node:fs";
import { rootCollectionOf } from "../lib/auth.js";
import { addFeedToCollection, ensureFeedLazy, subscribe } from "../lib/subscribe.js";
import { db, pool, schema } from "../db/client.js";
import { eq } from "drizzle-orm";

const SMALLWEB = process.env.SMALLWEB_TXT ?? "smallweb.txt";
const count = Number(process.argv[2] ?? 200);
const handle = process.argv[3];

async function main() {
  const [account] = handle
    ? await db.select().from(schema.users).where(eq(schema.users.handle, handle))
    : await db.select().from(schema.users).orderBy(schema.users.id).limit(1);
  if (!account) throw new Error(handle ? `no user @${handle}` : "no users yet; sign up first");
  const rootCollectionId = await rootCollectionOf(account.id);
  if (!rootCollectionId) throw new Error("user has no root collection");
  const user = { id: account.id, rootCollectionId };
  console.log(`user #${user.id}, root collection #${user.rootCollectionId}`);

  const ars = await subscribe(user.rootCollectionId, "https://feeds.arstechnica.com/arstechnica/index");
  console.log("ars:", ars.status, ars.status === "subscribed" ? `${ars.feed.title} (#${ars.feed.id})` : "");

  if (count > 0) {
    const all = readFileSync(SMALLWEB, "utf8").split("\n").map((l) => l.trim()).filter((l) => l.startsWith("http"));
    // Deterministic sample so re-running seeds the same set.
    const step = Math.max(1, Math.floor(all.length / count));
    const sample = all.filter((_, i) => i % step === 0).slice(0, count);

    let [col] = await db.select().from(schema.collections).where(eq(schema.collections.slug, "small-web"));
    if (!col) [col] = await db.insert(schema.collections).values({ userId: user.id, parentId: user.rootCollectionId, name: "Small Web", slug: "small-web", description: "A sample of the Kagi Small Web list" }).returning();

    let added = 0;
    for (const url of sample) {
      try {
        const feed = await ensureFeedLazy(url);
        await addFeedToCollection(col.id, feed.id);
        added++;
      } catch (e) {
        console.warn(`skip ${url}: ${e instanceof Error ? e.message : e}`);
      }
    }
    console.log(`small web: ${added} feeds registered in collection #${col.id}; the scheduler will fetch them`);
  }
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
