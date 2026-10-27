/**
 * Search-only disposable corpus. Never reads .env or writes to the database
 * named by the supplied admin URL; all writes happen in a newly created DB.
 * Only plain localhost postgres/postgresql URLs are accepted: query parameters
 * can override node-pg's target (for example ?host=remote.example), so none are
 * allowed, including otherwise benign connection options.
 */
import pg from "pg";
import { execFileSync } from "node:child_process";
import { writeFile, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { applyMigrations, readMigrations } from "../db/migrations.js";

export const SEARCH_BASELINE = "3a57ed3f693520e5acd220230dc13e5c62f8d908";

export async function loadSearchBaseline() {
  const root = fileURLToPath(new URL("../../../../", import.meta.url));
  const source = execFileSync("git", ["-C", root, "show", `${SEARCH_BASELINE}:packages/api/src/routes/search.ts`], { encoding: "utf8" })
    .replace(/async function (searchFeeds|searchPosts|searchCollections)\(/g, "export async function $1(");
  const target = new URL(`../routes/.search-perf-baseline-${process.pid}-${Date.now()}.ts`, import.meta.url);
  await writeFile(target, source, { flag: "wx" });
  try {
    return await import(target.href) as typeof import("../routes/search.js");
  } finally {
    await unlink(target);
  }
}

export async function withSearchCorpus<T>(size: number, run: (pool: pg.Pool) => Promise<T>, feedCount = 42, matchFraction = 0.7): Promise<T> {
  const address = process.env.MIGRATION_TEST_DATABASE_URL;
  if (!address) throw new Error("Set MIGRATION_TEST_DATABASE_URL to a disposable local PostgreSQL admin connection; .env is never loaded");
  const url = new URL(address);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || url.search || url.hash) {
    throw new Error("Search fixtures require a plain PostgreSQL URL without query parameters or fragments");
  }
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new Error("Search fixtures only permit a localhost PostgreSQL server");
  }
  if (!Number.isSafeInteger(size) || size < 6000 || size > 2_000_000) throw new Error("Corpus size must be 6000..2000000");
  if (!Number.isSafeInteger(feedCount) || feedCount < 42 || feedCount > 20_000) throw new Error("Feed count must be 42..20000");
  if (!Number.isFinite(matchFraction) || matchFraction <= 0 || matchFraction > 1) throw new Error("Match fraction must be greater than 0 and at most 1");
  const newsEvery = Math.max(17, Math.round(1 / matchFraction) * 17);
  const admin = new pg.Pool({ connectionString: url.toString(), max: 1 });
  const name = `thicket_search_test_${process.pid}_${Date.now()}`;
  let pool: pg.Pool | undefined;
  let created = false;
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    created = true;
    url.pathname = `/${name}`;
    pool = new pg.Pool({ connectionString: url.toString(), max: 5, statement_timeout: 60_000 });
    await applyMigrations(pool, readMigrations(), () => {});
    await pool.query(`
      INSERT INTO users (id, handle) VALUES (1, 'viewer'), (2, 'followed'), (3, 'stranger');
      INSERT INTO feeds (id, url, title, language, created_at)
      SELECT n, 'https://feed' || n || '.example/rss',
             CASE WHEN n >= ${feedCount - 1} THEN 'news privacy archive ' || n ELSE 'Publisher ' || n END,
             CASE WHEN n % 3 = 0 THEN NULL WHEN n % 3 = 1 THEN 'en' ELSE 'fr' END,
             now() - ((n % 42 + 1) || ' days')::interval FROM generate_series(1, ${feedCount}) n;
      INSERT INTO collections (id, user_id, parent_id, name, slug, visibility) VALUES
        (1, 1, NULL, 'Root', 'root', 'private'), (2, 2, NULL, 'Root', 'root', 'private'),
        (3, 2, 2, 'Public', 'public', 'public'), (4, 2, 2, 'Friends', 'friends', 'friends'),
        (5, 2, 2, 'Private', 'private', 'private'), (6, 3, NULL, 'Root', 'root', 'private'),
        (7, 3, 6, 'Copy', 'copy', 'public');
      UPDATE collections SET copied_from_id = 3 WHERE id = 7;
      INSERT INTO collection_feeds (collection_id, feed_id) VALUES (3, 1), (3, 2), (4, 3), (5, 4), (7, 1);
      INSERT INTO user_follows (follower_id, followee_id) VALUES (1, 2), (2, 1);
      INSERT INTO blocks (user_id, feed_id) VALUES (1, 4);
    `);
    await pool.query(`
      INSERT INTO items (id, feed_id, dedupe_key, url, title, summary, content, published_at)
      SELECT n, ((n - 1) % ${feedCount - 2}) + 1, n::text, 'https://story.example/' || n,
             CASE WHEN n = 1 THEN 'mycorrhiza'
                  WHEN n <= $1 * ${matchFraction} AND n % 3 = 0 THEN 'privacy news ' || n
                  WHEN n % ${newsEvery} = 0 THEN 'news ' || n ELSE 'Story ' || n END,
             CASE WHEN n <= $1 * ${matchFraction} AND n % 3 = 1 THEN 'privacy news summary' ELSE 'A summary' END,
             CASE WHEN n <= $1 * ${matchFraction} AND n % 3 = 2 THEN 'privacy news body' ELSE 'Other content' END
               || CASE WHEN n <= 3999 THEN ' boundaryunder' ELSE '' END
               || CASE WHEN n <= 4000 THEN ' boundaryexact' ELSE '' END,
             now() - interval '120 days' + n * interval '120 days' / $1
      FROM generate_series(1, $1::int) n
    `, [size]);
    await pool.query(`
      INSERT INTO items (id, feed_id, dedupe_key, url, title, published_at) VALUES
        ($1 + 1, ${feedCount}, 'old', 'https://story.example/old', 'news privacy', now() - interval '400 days'),
        ($1 + 2, 1, 'recent', 'https://story.example/recent', 'news privacy', now() - interval '1 hour')
    `, [size]);
    await pool.query(`
      INSERT INTO bookmarks (user_id, item_id, feed_id, url, note)
      SELECT 1, id, feed_id, url, CASE WHEN id % 2 = 0 THEN 'A public note' END
      FROM items WHERE id > $1 - 200 AND id % 17 = 0
    `, [size]);
    await pool.query(`
      UPDATE feeds f SET
        posts_90d = (SELECT count(*) FROM items i WHERE i.feed_id = f.id AND i.published_at > now() - interval '90 days'),
        posts_30d = (SELECT count(*) FROM items i WHERE i.feed_id = f.id AND i.published_at > now() - interval '30 days'),
        last_item_at = (SELECT max(published_at) FROM items i WHERE i.feed_id = f.id);
      ANALYZE;
    `);
    return await run(pool);
  } finally {
    await pool?.end();
    if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin.end();
  }
}
