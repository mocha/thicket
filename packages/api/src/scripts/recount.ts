/**
 * Recount the stored sort counts now, rather than waiting for the hourly and
 * nightly passes (lib/counts.ts). Safe to run any time, as often as you like.
 *
 *   pnpm recount
 */
import { endPools } from "../db/client.js";
import { reconcile, recountWindows } from "../lib/counts.js";

try {
  const drift = await reconcile();
  console.log(`totals: corrected ${drift.followers} follower counts, ${drift.items} post counts, ${drift.collections} collection sizes`);
  console.log(`windows: ${await recountWindows()} feeds' 30/90-day post counts changed`);
} finally {
  await endPools();
}
