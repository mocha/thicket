/**
 * In-process poller. Every tick, grab due feeds and refresh them with bounded
 * global concurrency and one feed at a time per host.
 *
 * Deliberate shortcut: this runs inside the API process. The upgrade path is to
 * move this file into a separate worker process reading the same table, which
 * changes nothing about the data model. Until a single box can't keep up, the
 * simple version wins.
 *
 * Politeness lives in feeds/hosts.ts, underneath every request: the gap between
 * requests to a host, pausing a host that says slow down, and noticing a host
 * that is down. This file only makes sure it never asks one host for two feeds
 * at once.
 */
import { dueFeeds, refreshFeed } from "./refresh.js";
import { hostKey, loadHosts } from "./hosts.js";

const PER_HOST = 1;

export type SchedulerStats = { ticks: number; refreshed: number; errors: number; inFlight: number; lastTickAt: string | null };

export function startScheduler(opts: { tickMs: number; concurrency: number; log?: (m: string) => void }) {
  const log = opts.log ?? (() => {});
  const stats: SchedulerStats = { ticks: 0, refreshed: 0, errors: 0, inFlight: 0, lastTickAt: null };
  const inFlightIds = new Set<number>();
  const perHost = new Map<string, number>();
  let stopped = false;

  async function tick() {
    if (stopped) return;
    stats.ticks++;
    stats.lastTickAt = new Date().toISOString();
    await loadHosts();
    const free = opts.concurrency - inFlightIds.size;
    if (free <= 0) return;
    const due = await dueFeeds(free * 4);
    let launched = 0;
    for (const f of due) {
      if (launched >= free) break;
      if (inFlightIds.has(f.id)) continue;
      const host = hostKey(f.url);
      if ((perHost.get(host) ?? 0) >= PER_HOST) continue;
      inFlightIds.add(f.id);
      perHost.set(host, (perHost.get(host) ?? 0) + 1);
      stats.inFlight = inFlightIds.size;
      launched++;
      refreshFeed(f.id)
        .then((r) => {
          stats.refreshed++;
          if (r.error) stats.errors++;
          if (r.itemsNew > 0 || r.error) log(`feed ${f.id} ${r.status ?? "-"} +${r.itemsNew} ${r.durationMs}ms ${r.error ?? ""}`.trim());
        })
        .catch((e) => {
          stats.errors++;
          log(`feed ${f.id} crashed: ${e}`);
        })
        .finally(() => {
          inFlightIds.delete(f.id);
          perHost.set(host, (perHost.get(host) ?? 1) - 1);
          stats.inFlight = inFlightIds.size;
          drain();
        });
    }
  }

  let drainPending = false;
  const drain = () => {
    if (drainPending || stopped) return;
    drainPending = true;
    setTimeout(() => { drainPending = false; void tick().catch((e) => log(`tick failed: ${e}`)); }, 50);
  };
  const timer = setInterval(() => void tick().catch((e) => log(`tick failed: ${e}`)), opts.tickMs);
  void tick();
  return { stats, stop: () => { stopped = true; clearInterval(timer); } };
}
