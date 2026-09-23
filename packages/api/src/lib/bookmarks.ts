/**
 * Saving a post as a bookmark, shared by the bookmark button and by writing a
 * note (which saves the post too; issue #84).
 */
import { sql } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import { NOTE_MAX, postAddressSql } from "./notes.js";
import { isHttpUrl } from "../feeds/normalize.js";

type Snapshot = typeof schema.bookmarks.$inferInsert;

/** A post's own page here, which is what a post with no link of its own is saved under. */
const POST_PAGE = /^\/feeds\/\d+\/[a-z0-9-]+\/\d+$/;

/**
 * Can this be a bookmark's address? A web address (http or https), or a post's
 * page here. Nothing else: a bookmark is a link others may click, and a
 * javascript: address would run code when they did.
 */
export function isSavedAddress(url: string): boolean {
  return POST_PAGE.test(url) || isHttpUrl(url);
}

/**
 * What a bookmark of this post keeps: its own copy of the post as it is now,
 * so pruning the post or removing its feed never breaks the bookmark. A post
 * with no link of its own is saved under its page here. Null when there is no
 * such post.
 */
export async function snapshotOfItem(userId: number, itemId: number): Promise<Snapshot | null> {
  const [it] = (await db.execute<{ id: number; feedId: number; url: string; title: string | null; summary: string | null; imageUrl: string | null; siteTitle: string | null; author: string | null; publishedAt: string }>(sql`
    select i.id, i.feed_id as "feedId", ${postAddressSql} as url, i.title, i.summary, i.image_url as "imageUrl",
           f.title as "siteTitle", i.author, i.published_at as "publishedAt"
    from items i join feeds f on f.id = i.feed_id where i.id = ${itemId}
  `)).rows;
  if (!it) return null;
  return {
    userId, itemId: Number(it.id), feedId: Number(it.feedId), url: it.url, title: it.title, summary: it.summary,
    imageUrl: it.imageUrl, siteTitle: it.siteTitle, author: it.author, publishedAt: new Date(it.publishedAt),
  };
}

/** A note as typed, cleaned up, or the reason it can't be saved. */
export function cleanNote(raw: unknown): { body: string } | { error: string } {
  const body = (typeof raw === "string" ? raw : "").replace(/\r\n/g, "\n").trim();
  if (!body) return { error: "Write something first." };
  if (body.length > NOTE_MAX) return { error: `Notes are at most ${NOTE_MAX} characters; this one is ${body.length}.` };
  return { body };
}

export type NoteRow = { id: number; body: string; createdAt: string; updatedAt: string };

/** A bookmark row's note in the shape the web app calls a Note, or null. */
export function noteOf(b: { id: number; note: string | null; noteCreatedAt: Date | string | null; noteUpdatedAt: Date | string | null }): NoteRow | null {
  if (b.note === null) return null;
  return { id: b.id, body: b.note, createdAt: new Date(b.noteCreatedAt ?? 0).toISOString(), updatedAt: new Date(b.noteUpdatedAt ?? 0).toISOString() };
}
