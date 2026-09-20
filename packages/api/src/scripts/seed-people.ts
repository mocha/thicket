/**
 * Seed a few public people, each with a public collection built from feeds that
 * already exist (run `pnpm seed` first). This is what fills the Collections and
 * People views in Explore — both of which, by design, only show *other*
 * people's public collections and profiles, so a lone account sees them empty.
 *
 *   pnpm --filter @thicket/api tsx --env-file=../../.env src/scripts/seed-people.ts
 *
 * Idempotent: a handle that already exists is skipped.
 */
import { createUser, findUserByHandle, rootCollectionOf } from "../lib/auth.js";
import { addFeedToCollection } from "../lib/subscribe.js";
import { db, pool, schema } from "../db/client.js";
import { eq } from "drizzle-orm";

const PASSWORD = "thicketdev123";

type Col = { name: string; description: string; feeds: number[] };
type Person = { handle: string; displayName: string; bio: string; collections: Col[] };

/** Feed ids come from the `pnpm seed` set (1 = Ars, 2 = Daring Fireball, …). */
const PEOPLE: Person[] = [
  {
    handle: "maya", displayName: "Maya Chen",
    bio: "Design engineer. Collects thoughtful writing about the craft of the web.",
    collections: [
      { name: "Frontend reading", description: "The writers who make me better at the front of the web.", feeds: [2, 6, 7, 8, 22, 23, 24] },
      { name: "Design inspiration", description: "A smaller shelf for taste and detail.", feeds: [2, 22, 24] },
    ],
  },
  {
    handle: "devon", displayName: "Devon Park",
    bio: "Backend engineer, distributed systems. Reads people who explain hard things well.",
    collections: [
      { name: "Deep engineering", description: "Systems, performance, and the hard parts, explained clearly.", feeds: [4, 13, 16, 17, 18, 20, 21] },
    ],
  },
  {
    handle: "priya", displayName: "Priya Nair",
    bio: "PM and essayist. Big-idea writing and the occasional rabbit hole.",
    collections: [
      { name: "Long reads & big ideas", description: "Essays worth a full cup of coffee.", feeds: [11, 25, 28, 29, 30, 31] },
    ],
  },
  {
    handle: "sam", displayName: "Sam Rivera",
    bio: "Curious generalist. A little tech, a little art, a lot of open tabs.",
    collections: [
      { name: "A bit of everything", description: "The mixed feed I actually read each morning.", feeds: [1, 5, 9, 14, 27] },
    ],
  },
  {
    handle: "lee", displayName: "Lee Okafor",
    bio: "Writes about creativity and making things. Newsletter enjoyer.",
    collections: [
      { name: "On making things", description: "For anyone who makes things and wants to keep at it.", feeds: [11, 26, 27, 28, 31] },
    ],
  },
  {
    handle: "noor", displayName: "Noor Haddad",
    bio: "Frontend + accessibility. Believes the web is for everyone.",
    collections: [
      { name: "Accessible web", description: "Building a web that leaves no one out.", feeds: [6, 7, 8, 22, 23] },
    ],
  },
];

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

async function main() {
  for (const p of PEOPLE) {
    if (await findUserByHandle(p.handle)) {
      console.log(`@${p.handle}: exists, skipping`);
      continue;
    }
    const user = await createUser({ handle: p.handle, password: PASSWORD, displayName: p.displayName });
    await db.update(schema.users).set({ bio: p.bio }).where(eq(schema.users.id, user.id));
    const root = await rootCollectionOf(user.id);
    if (!root) throw new Error(`@${p.handle} has no root collection`);

    for (const c of p.collections) {
      const [col] = await db
        .insert(schema.collections)
        .values({ userId: user.id, parentId: root, name: c.name, slug: slugify(c.name), description: c.description })
        .returning();
      for (const feedId of c.feeds) await addFeedToCollection(col.id, feedId);
      console.log(`@${p.handle}: "${c.name}" (${c.feeds.length} feeds)`);
    }
  }
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
