/**
 * OPML in and out. Export is what "copy" consumes later; import is how a saved
 * collection comes back. Nested outlines map to nested collections: an outline
 * with an xmlUrl is a feed, one without is a sub-collection. (Folders, not tags.
 * This is the documented decision on the OPML ambiguity.)
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { generateOpml, parseOpml } from "feedsmith";
import { db, schema } from "../db/client.js";
import { addFeedToCollection, ensureFeedLazy } from "./subscribe.js";
import { uniqueCollectionSlug } from "./slug.js";
import { isHttpUrl } from "../feeds/normalize.js";
import { type ShareLevel } from "./visibility.js";

type Outline = { text: string; title?: string; type?: string; xmlUrl?: string; htmlUrl?: string; description?: string; outlines?: Outline[] };

/**
 * The export walks sub-collections, so it has to apply their audiences like
 * every other read of the tree: exporting a public collection must not hand
 * out the private one nested inside it. `levels` is what this reader may see;
 * the owner exporting their own tree passes nothing and gets all of it.
 */
async function outlinesFor(collectionId: number, levels?: ShareLevel[]): Promise<Outline[]> {
  const feeds = await db.execute<{ url: string; siteUrl: string | null; title: string | null; description: string | null }>(sql`
    select f.url, f.site_url as "siteUrl", coalesce(cf.title_override, f.title) as title, f.description
    from collection_feeds cf join feeds f on f.id = cf.feed_id
    where cf.collection_id = ${collectionId} order by lower(coalesce(cf.title_override, f.title, f.url))
  `);
  const childWhere = levels
    ? and(eq(schema.collections.parentId, collectionId), inArray(schema.collections.visibility, levels))
    : eq(schema.collections.parentId, collectionId);
  const children = await db.select().from(schema.collections).where(childWhere).orderBy(schema.collections.name);
  const out: Outline[] = [];
  for (const c of children) {
    out.push({ text: c.name, title: c.name, description: c.description ?? undefined, outlines: await outlinesFor(c.id, levels) });
  }
  for (const f of feeds.rows) {
    out.push({ text: f.title ?? f.url, title: f.title ?? undefined, type: "rss", xmlUrl: f.url, htmlUrl: f.siteUrl && isHttpUrl(f.siteUrl) ? f.siteUrl : undefined, description: f.description ?? undefined });
  }
  return out;
}

/** ownerId is the owner's profile URL on this instance; peers use it to say where a copy came from. */
export async function exportCollectionOpml(
  collection: { id: number; name: string },
  ownerName?: string | null,
  ownerId?: string | null,
  levels?: ShareLevel[],
): Promise<string> {
  const outlines = await outlinesFor(collection.id, levels);
  const head = { title: collection.name, dateCreated: new Date(), ownerName: ownerName ?? undefined, ownerId: ownerId ?? undefined, docs: "http://opml.org/spec2.opml" };
  // Nothing to write: an empty collection, or one whose only contents this
  // reader may not see. The generator refuses a body with no outlines, so the
  // empty document is written by hand — a reader asking for a file gets a
  // file, not a 500.
  if (outlines.length === 0) {
    const x = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const line = (tag: string, v?: string | null) => (v ? `    <${tag}>${x(v)}</${tag}>\n` : "");
    return `<?xml version="1.0" encoding="utf-8"?>\n<opml version="2.0">\n  <head>\n${line("title", head.title)}${line("dateCreated", head.dateCreated.toUTCString())}${line("ownerName", ownerName)}${line("ownerId", ownerId)}${line("docs", head.docs)}  </head>\n  <body></body>\n</opml>\n`;
  }
  return generateOpml({ head, body: { outlines } });
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
        // Re-importing the same document merges into the sub-collection it made
        // last time rather than piling up copies, so match on the outline's own
        // text. Not on the slug: slugs are unique per user now, so this folder's
        // may carry a -2 that the document knows nothing about.
        let [child] = await db.select().from(schema.collections).where(sql`${schema.collections.parentId} = ${target} and ${schema.collections.name} = ${name}`);
        if (!child) {
          [child] = await db.insert(schema.collections).values({ userId, parentId: target, name, slug: await uniqueCollectionSlug(userId, name), description: o.description ?? null }).returning();
          result.collections++;
        }
        await walk(o.outlines, child.id);
      }
    }
  }
  await walk(doc.body?.outlines as Outline[] | undefined, collectionId);
  return result;
}
