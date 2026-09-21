/**
 * Seed the instance with real feeds.
 *   pnpm seed                 → Ars Technica + 200 random Small Web feeds
 *   pnpm seed 1000            → Ars + 1000 random Small Web feeds
 *   pnpm seed 0               → Ars only
 *   pnpm seed 200 alice       → into a specific account (default: the first user)
 *
 * The Small Web list is a plain text file of one feed URL per line. The repo
 * ships one (packages/api/smallweb.txt), used by default; set SMALLWEB_TXT to
 * point at your own instead. Those feeds are registered lazily and the
 * scheduler fetches them in the background, which doubles as a realistic
 * load test of the poller.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { rootCollectionOf } from "../lib/auth.js";
import { addFeedToCollection, ensureFeedLazy, subscribe } from "../lib/subscribe.js";
import { db, pool, schema } from "../db/client.js";
import { and, eq } from "drizzle-orm";

// Resolve relative to this script, not the shell's working directory, so
// `pnpm seed` finds the bundled list wherever it's run from.
const SMALLWEB = process.env.SMALLWEB_TXT ?? fileURLToPath(new URL("../../smallweb.txt", import.meta.url));
const count = Number(process.argv[2] ?? 200);
const handle = process.argv[3];

async function main() {
  const [account] = handle
    ? await db.select().from(schema.users).where(eq(schema.users.handle, handle))
    : await db.select().from(schema.users).orderBy(schema.users.id).limit(1);
  if (!account) throw new Error(handle ? `no user @${handle}` : "no users yet; sign up first");
  const rootCollectionId = await rootCollectionOf(account.id);
  if (!rootCollectionId) throw new Error("user has no root collection");
  const user = { id: account.id, handle: account.handle, displayName: account.displayName, rootCollectionId, defaultCollectionId: null, trackActivity: false };
  console.log(`user #${user.id}, root collection #${user.rootCollectionId}`);

  const ars = await subscribe(user, "https://feeds.arstechnica.com/arstechnica/index");
  console.log("ars:", ars.status, ars.status === "subscribed" ? `${ars.feed.title} (#${ars.feed.id})` : "");

  // Ten collections, all top-level. Sub-collections are on hold (see the note
  // in web collections.svelte.ts), so this seed deliberately doesn't nest — it
  // just gives a realistic, slightly crowded list to work against, e.g. for the
  // "Add a feed" picker. Idempotent: keyed on (this user, slug), so re-running
  // seed reuses them.
  const ensureCollection = async (name: string, slug: string, parentId: number, description?: string) => {
    let [c] = await db.select().from(schema.collections)
      .where(and(eq(schema.collections.userId, user.id), eq(schema.collections.slug, slug)));
    if (!c) [c] = await db.insert(schema.collections)
      .values({ userId: user.id, parentId, name, slug, description: description ?? null }).returning();
    return c;
  };

  const seedCollections: Array<{ name: string; slug: string; description?: string; feeds: string[] }> = [
    { name: "News", slug: "news", description: "World headlines", feeds: ["https://feeds.bbci.co.uk/news/world/rss.xml", "https://feeds.npr.org/1001/rss.xml", "https://www.theguardian.com/world/rss"] },
    { name: "Technology", slug: "technology", description: "What's shipping and what's breaking", feeds: ["https://www.theverge.com/rss/index.xml", "https://hnrss.org/frontpage", "https://techcrunch.com/feed/"] },
    { name: "Business", slug: "business", feeds: ["https://feeds.bbci.co.uk/news/business/rss.xml", "https://www.theguardian.com/uk/business/rss", "https://feeds.npr.org/1006/rss.xml"] },
    { name: "Science", slug: "science", feeds: ["https://feeds.bbci.co.uk/news/science_and_environment/rss.xml", "https://www.sciencedaily.com/rss/all.xml", "https://api.quantamagazine.org/feed/"] },
    { name: "Film", slug: "film", feeds: ["https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml", "https://variety.com/feed/", "https://www.theguardian.com/film/rss"] },
    { name: "Music", slug: "music", feeds: ["https://www.stereogum.com/feed/", "https://pitchfork.com/feed/pitchfork/rss", "https://www.theguardian.com/music/rss"] },
    { name: "Gaming", slug: "gaming", feeds: ["https://www.polygon.com/rss/index.xml", "https://www.eurogamer.net/feed", "https://www.pcgamer.com/rss/"] },
    { name: "Design", slug: "design", feeds: ["https://www.smashingmagazine.com/feed/", "https://www.itsnicethat.com/rss", "https://www.core77.com/feed"] },
    { name: "Sports", slug: "sports", feeds: ["https://feeds.bbci.co.uk/sport/rss.xml", "https://www.espn.com/espn/rss/news", "https://www.theguardian.com/sport/rss"] },
    { name: "Longreads", slug: "longreads", description: "Save the big ones for later", feeds: ["https://longreads.com/feed/", "https://aeon.co/feed.rss", "https://www.theatlantic.com/feed/all/"] },
  ];

  for (const spec of seedCollections) {
    const col = await ensureCollection(spec.name, spec.slug, user.rootCollectionId, spec.description);
    for (const url of spec.feeds) {
      try {
        const feed = await ensureFeedLazy(url);
        await addFeedToCollection(col.id, feed.id);
      } catch (e) {
        console.warn(`skip ${url}: ${e instanceof Error ? e.message : e}`);
      }
    }
  }
  console.log(`collections: ${seedCollections.length} top-level under root`);

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
