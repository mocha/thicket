/**
 * Profile pictures. Upload and remove your own; anyone may fetch one by handle,
 * subject to the same privacy rule as the rest of a profile — a private account
 * hides its picture from everyone but its owner.
 *
 * Storage mirrors feed icons: the bytes live in Postgres (user_avatars), served
 * back here so there is no disk or bucket to run. Whatever a browser sends is
 * re-encoded on the way in — cropped square, shrunk to 256px, turned into WebP,
 * with any embedded metadata (including camera location) dropped. So the stored
 * image is small, uniform, and can't smuggle anything past us.
 */
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { db, schema } from "../db/client.js";
import { currentUser, normalizeHandle } from "../lib/auth.js";

export const users = new Hono();

/** The square, in pixels, every avatar is normalized to. */
const SIZE = 256;
/** Cap the upload before we decode it: a profile picture is never this big. */
const MAX_UPLOAD = 6 * 1024 * 1024;
/**
 * Ceiling on decoded pixels, so a small file that unpacks to an enormous image
 * (a "decompression bomb") can't spike memory. 100 megapixels is far above any
 * real photo yet stops the abusive ones.
 */
const MAX_PIXELS = 100_000_000;

/** Turn whatever was uploaded into our canonical avatar bytes, or throw. */
async function normalize(input: Buffer): Promise<{ bytes: Buffer; contentType: string }> {
  const bytes = await sharp(input, { limitInputPixels: MAX_PIXELS })
    .rotate() // honor EXIF orientation before we strip the metadata
    .resize(SIZE, SIZE, { fit: "cover", position: "centre" })
    .webp({ quality: 82 })
    .toBuffer();
  return { bytes, contentType: "image/webp" };
}

/** Upload (or replace) my profile picture. The browser sends the cropped square; we re-encode it anyway. */
users.post("/me/avatar", bodyLimit({ maxSize: MAX_UPLOAD, onError: (c) => c.json({ error: "That image is too large. Keep it under 5MB." }, 413) }), async (c) => {
  const user = currentUser(c);
  const body = await c.req.parseBody().catch(() => ({}) as Record<string, string | File>);
  const file = body["avatar"];
  if (!(file instanceof File)) return c.json({ error: "No image was sent." }, 400);
  const input = Buffer.from(await file.arrayBuffer());

  let normalized: { bytes: Buffer; contentType: string };
  try {
    normalized = await normalize(input);
  } catch {
    return c.json({ error: "That file isn’t an image we can read." }, 400);
  }

  const hash = createHash("sha256").update(normalized.bytes).digest("hex");
  const updatedAt = new Date();
  const row = { contentType: normalized.contentType, width: SIZE, bytes: normalized.bytes, hash, updatedAt };
  await db.insert(schema.userAvatars).values({ userId: user.id, ...row }).onConflictDoUpdate({ target: schema.userAvatars.userId, set: row });
  return c.json({ hasAvatar: true, avatarUpdatedAt: updatedAt.toISOString() });
});

/** Remove my profile picture; back to a monogram. */
users.delete("/me/avatar", async (c) => {
  const user = currentUser(c);
  await db.delete(schema.userAvatars).where(eq(schema.userAvatars.userId, user.id));
  return c.body(null, 204);
});

/**
 * Serve a person's picture. Long-lived cache; the client hangs a ?v= off the
 * updatedAt so a new picture shows at once despite the cache. A private profile
 * shows its picture only to its owner, matching every other section.
 */
users.get("/:handle/avatar", async (c) => {
  const handle = normalizeHandle(c.req.param("handle"));
  const [row] = await db
    .select({
      userId: schema.userAvatars.userId,
      contentType: schema.userAvatars.contentType,
      bytes: schema.userAvatars.bytes,
      hash: schema.userAvatars.hash,
      visibility: schema.users.profileVisibility,
    })
    .from(schema.userAvatars)
    .innerJoin(schema.users, eq(schema.users.id, schema.userAvatars.userId))
    .where(eq(schema.users.handle, handle));
  if (!row) return c.body(null, 404);
  const viewer = c.get("user");
  if (row.visibility === "private" && viewer?.id !== row.userId) return c.body(null, 404);

  const etag = `"${row.hash}"`;
  if (c.req.header("if-none-match") === etag) return c.body(null, 304);
  c.header("content-type", row.contentType);
  c.header("cache-control", "public, max-age=86400, stale-while-revalidate=604800");
  c.header("etag", etag);
  return c.body(new Uint8Array(row.bytes));
});
