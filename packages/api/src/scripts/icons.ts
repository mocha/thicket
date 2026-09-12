/** Backfill site icons for feeds that have never been checked. `pnpm icons` */
import { isNull, sql } from "drizzle-orm";
import { db, pool, schema } from "../db/client.js";
import { markAllGeneric, refreshIcon } from "../feeds/icons.js";

const CONCURRENCY = 8;

async function main() {
  const feeds = await db.select({ id: schema.feeds.id, url: schema.feeds.url, siteUrl: schema.feeds.siteUrl }).from(schema.feeds).where(isNull(schema.feeds.iconCheckedAt));
  console.log(`${feeds.length} feeds to check`);
  let ok = 0, done = 0;
  const queue = [...feeds];
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    for (let f = queue.shift(); f; f = queue.shift()) {
      const got = await refreshIcon(f.id, f.siteUrl, f.url).catch(() => false);
      if (got) ok++;
      done++;
      if (done % 25 === 0) console.log(`${done}/${feeds.length} checked, ${ok} icons`);
    }
  }));
  const generic = await markAllGeneric();
  console.log(` icons flagged as platform defaults`);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.feedIcons);
  console.log(`done: ${ok} new icons this run, ${n} total cached`);
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
