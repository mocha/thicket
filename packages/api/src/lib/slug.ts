import { sql } from "drizzle-orm";
import { db } from "../db/client.js";

/**
 * Collection slugs: the readable half of /@handle/collections/:slug.
 *
 * Unique per user, not per parent (migration 0005). Per-parent uniqueness let a
 * "News" under "Tech" and a top-level "News" both exist while only one of them
 * had a working URL — the address resolved to the shallowest match and the other
 * was unreachable. One slug per person means one address per collection, which
 * is the promise the URL scheme already made.
 */
export function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "untitled";
}

/** Everything slugify can produce, so callers can ask "would this collide?". */
export async function slugTaken(userId: number, slug: string, excludeId?: number): Promise<boolean> {
  const rows = await db.execute(sql`
    select 1 from collections where user_id = ${userId} and slug = ${slug}
    ${excludeId ? sql`and id <> ${excludeId}` : sql``} limit 1`);
  return rows.rows.length > 0;
}

type Executor = Pick<typeof db, "execute">;

/**
 * A slug for this name that no other collection of this user holds, appending
 * -2, -3… when it must. For the paths where nobody is at the keyboard to be
 * asked: copying a collection, importing a file, walking an OPML tree. When a
 * person typed the name, tell them it is taken instead — a silent rename is a
 * worse answer than a sentence.
 *
 * The LIKE pattern needs no escaping: slugify only ever emits [a-z0-9-].
 */
export async function uniqueCollectionSlug(
  userId: number,
  name: string,
  opts: { exclude?: number; tx?: Executor } = {},
): Promise<string> {
  const base = slugify(name);
  const q = opts.tx ?? db;
  const rows = await q.execute<{ slug: string }>(sql`
    select slug from collections
    where user_id = ${userId} and (slug = ${base} or slug like ${base + "-%"})
    ${opts.exclude ? sql`and id <> ${opts.exclude}` : sql``}`);
  const taken = new Set(rows.rows.map((r) => r.slug));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}
