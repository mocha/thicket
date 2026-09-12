/**
 * OPML in and out. Export is what "copy" consumes later; import is how a saved
 * collection comes back. Nested outlines map to nested collections: an outline
 * with an xmlUrl is a feed, one without is a sub-collection. (Folders, not tags.
 * This is the documented decision on the OPML ambiguity.)
 */
import { eq, sql } from "drizzle-orm";
import { generateOpml, parseOpml } from "feedsmith";
import { db, schema } from "../db/client.js";
import { addFeedToCollection, ensureFeedLazy } from "./subscribe.js";

type Outline = { text: string; title?: string; type?: string; xmlUrl?: string; htmlUrl?: string; description?: string; outlines?: Outline[] };

async function outlinesFor(collectionId: number): Promise<Outline[]> {
  const feeds = await db.execute<{ url: string; siteUrl: string | null; title: string | null; description: string | null }>(sql`
    select f.url, f.site_url as "siteUrl", coalesce(cf.title_override, f.title) as title, f.description
    from collection_feeds cf join feeds f on f.id = cf.feed_id
    where cf.collection_id = ${collectionId} order by lower(coalesce(cf.title_override, f.title, f.url))
  `);
  const children = await db.select().from(schema.collections).where(eq(schema.collections.parentId, collectionId)).orderBy(schema.collections.name);
  const out: Outline[] = [];
  for (const c of children) {
    out.push({ text: c.name, title: c.name, description: c.description ?? undefined, outlines: await outlinesFor(c.id) });
  }
  for (const f of feeds.rows) {
    out.push({ text: f.title ?? f.url, title: f.title ?? undefined, type: "rss", xmlUrl: f.url, htmlUrl: f.siteUrl ?? undefined, description: f.description ?? undefined });
  }
  return out;
}

/** ownerId is the owner's profile URL on this instance; peers use it to say where a copy came from. */
export async function exportCollectionOpml(collection: { id: number; name: string }, ownerName?: string | null, ownerId?: string | null): Promise<string> {
  const outlines = await outlinesFor(collection.id);
  return generateOpml({
    head: { title: collection.name, dateCreated: new Date(), ownerName: ownerName ?? undefined, ownerId: ownerId ?? undefined, docs: "http://opml.org/spec2.opml" },
    body: { outlines },
  });
}

export type ImportResult = { feeds: number; collections: number; skipped: string[] };

/** Import an OPML document into a collection. Feeds are registered lazily; the scheduler fetches them. */
export async function importOpml(userId: number, collectionId: number, text: string): Promise<ImportResult> {
  const doc = parseOpml(text);
  const result: ImportResult = { feeds: 0, collections: 0, skipped: [] };

  async function walk(outlines: Outline[] | undefined, target: number) {
    for (const o of outlines ?? []) {
      if (o.xmlUrl) {
        try {
          const feed = await ensureFeedLazy(o.xmlUrl);
          await addFeedToCollection(target, feed.id);
          if (!feed.title && (o.title || o.text)) await db.update(schema.feeds).set({ title: o.title ?? o.text }).where(eq(schema.feeds.id, feed.id));
          result.feeds++;
        } catch {
          result.skipped.push(o.xmlUrl);
        }
      } else if (o.outlines?.length) {
        const name = (o.title ?? o.text ?? "Untitled").trim() || "Untitled";
        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "untitled";
        let [child] = await db.select().from(schema.collections).where(sql`${schema.collections.parentId} = ${target} and ${schema.collections.slug} = ${slug}`);
        if (!child) {
          [child] = await db.insert(schema.collections).values({ userId, parentId: target, name, slug, description: o.description ?? null }).returning();
          result.collections++;
        }
        await walk(o.outlines, child.id);
      }
    }
  }
  await walk(doc.body?.outlines as Outline[] | undefined, collectionId);
  return result;
}
