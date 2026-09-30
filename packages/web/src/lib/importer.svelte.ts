/**
 * One import in progress, shared by the Import page and the first-run setup
 * dialog (api/src/lib/importer.ts does the reading and checking). The dialog
 * reads the file on its first step and the checks run while the reader picks
 * colors and fonts; the Import page then shows the same review, mostly
 * checked. Starting over is the only thing that throws it away.
 */
import { importApi, api, ApiError, IMPORT_CHECK_BATCH, type ImportPreview, type ImportFeed, type ImportCommitted } from './api';
import { loadCollections } from './collections.svelte';

export type ImportStep = 'choose' | 'review' | 'done';
export type ImportGroup = { name: string; keep: boolean; open: boolean; feeds: ImportFeed[] };

/** Folders at or under this size start opened out on the review. */
export const SHOWN = 12;

export const imp = $state({
  step: 'choose' as ImportStep,
  busy: false,
  error: null as string | null,
  preview: null as ImportPreview | null,
  groups: [] as ImportGroup[],
  checked: 0,
  toCheck: 0,
  checking: false,
  /** How many feeds are in a second (or third) attempt, for the progress line. 0 = first pass. */
  retrying: 0,
  committed: [] as ImportCommitted[],
});

/** Which reading the checks belong to, so starting over stops the old ones landing on the new list. */
let run = 0;

export const ready = (g: ImportGroup) => g.feeds.filter((f) => f.state !== 'failed');
export const refused = (g: ImportGroup) => g.feeds.filter((f) => f.state === 'failed');
/**
 * A collection is only worth making if something in it is known to work: a
 * feed that checked out, or one I already follow. Feeds that couldn't be
 * checked ride along with the ones that did, but they can't be the whole
 * reason for a collection — that is how a folder of dead addresses used to
 * become an empty collection.
 */
export const good = (g: ImportGroup) => g.feeds.filter((f) => f.state === 'ok');
/** Every feed in the group has been checked, so its verdict is final. */
export const settled = (g: ImportGroup) => !g.feeds.some((f) => f.state === 'pending');
export const canKeep = (g: ImportGroup) => good(g).length > 0;

/** Read a file or link into a review and start checking. True when there is now something to review. */
export async function readImport(get: () => Promise<ImportPreview>, via: string): Promise<boolean> {
  if (imp.busy) return false;
  imp.busy = true; imp.error = null;
  try {
    const p = await get();
    imp.preview = p;
    imp.groups = p.groups.map((g) => ({ name: g.name, keep: true, open: g.feeds.length <= SHOWN, feeds: g.feeds }));
    imp.step = 'review';
    api.event('import_read', { via, source: p.source, groups: p.groups.length, feeds: p.groups.reduce((n, g) => n + g.feeds.length, 0) });
    void checkAll();
    return true;
  } catch (e) {
    imp.error = e instanceof Error ? e.message : String(e);
    return false;
  } finally {
    imp.busy = false;
  }
}

/** Apply one result everywhere the feed appears: a feed in two folders is one check. */
function apply(url: string, patch: Partial<ImportFeed>) {
  for (const g of imp.groups) for (const f of g.feeds) if (f.url === url) Object.assign(f, patch);
}

/**
 * One pass over a list of addresses, in small batches. The server keeps to
 * one request per site at a time; this keeps a few batches in flight, so a
 * thousand-feed file costs a few minutes of patience rather than a burst.
 */
async function pass(urls: string[], mine: number) {
  imp.toCheck = urls.length; imp.checked = 0;
  const batches: string[][] = [];
  for (let i = 0; i < urls.length; i += IMPORT_CHECK_BATCH) batches.push(urls.slice(i, i + IMPORT_CHECK_BATCH));
  // A few batches in flight, so one slow site doesn't hold up the rest. The server still takes turns per site.
  const lane = async () => {
    for (let b = batches.shift(); b && mine === run; b = batches.shift()) {
      const { results } = await importApi.check(b);
      if (mine !== run) return;
      for (const r of results) {
        apply(r.url, { state: r.state, reason: r.reason, retry: r.retry, ...(r.title ? { title: r.title } : {}) });
        // The feed has moved and left a redirect behind: follow it at its new address.
        if (r.finalUrl) apply(r.url, { url: r.finalUrl });
      }
      imp.checked += results.length;
    }
  };
  await Promise.all([lane(), lane(), lane()]);
}

/**
 * Trouble that passes on its own gets another go before the review settles.
 * Worth doing here and not only in the scheduler, because a folder is only
 * creatable once something in it is known to work: a connection that stumbles
 * for ten seconds would otherwise block the whole import behind feeds that
 * are perfectly fine. Only verdicts the server marked `retry` come back —
 * never a 429 or a paused host, which asked us to wait and meant it.
 *
 * The waits are short because the fault is usually a passing one on this end,
 * and bounded because a review that keeps someone waiting has stopped being
 * a review. The politeness layer still spaces every request per site.
 */
const RETRY_WAITS_MS = [4000, 12000];

async function retryPass(mine: number, wait: number) {
  const again = [...new Set(imp.groups.flatMap((g) => g.feeds.filter((f) => f.state === 'unsure' && f.retry).map((f) => f.url)))];
  if (!again.length) return false;
  imp.retrying = again.length;
  await new Promise((r) => setTimeout(r, wait));
  if (mine !== run) return false;
  // Back to "checking" while they are in flight, so a folder doesn't settle —
  // and turn its own checkbox off — on a verdict we are in the middle of redoing.
  for (const url of again) apply(url, { state: 'pending', reason: null });
  await pass(again, mine);
  imp.retrying = 0;
  return true;
}

/** Check every feed thicket hasn't seen, then give the passing troubles another go. */
async function checkAll() {
  const mine = ++run;
  const pending = [...new Set(imp.groups.flatMap((g) => g.feeds.filter((f) => f.state === 'pending').map((f) => f.url)))];
  imp.toCheck = pending.length; imp.checked = 0;
  if (!pending.length && !imp.groups.some((g) => g.feeds.some((f) => f.state === 'unsure' && f.retry))) return;
  imp.checking = true;
  try {
    if (pending.length) await pass(pending, mine);
    for (const wait of RETRY_WAITS_MS) {
      if (mine !== run) return;
      if (!(await retryPass(mine, wait))) break;
    }
  } catch (e) {
    if (mine !== run) return;
    // Stopped early (usually: far too much checking in an hour). What wasn't checked is added anyway, and the scheduler finds out.
    const why = e instanceof ApiError ? e.message : 'Checking stopped.';
    for (const g of imp.groups) for (const f of g.feeds) if (f.state === 'pending') Object.assign(f, { state: 'unsure', reason: `Not checked (${why}) It’s added anyway and will be tried.`, retry: false });
  } finally {
    if (mine === run) { imp.checking = false; imp.retrying = 0; }
  }
}

/** Make a collection of each kept group. */
export async function commitImport(kept: ImportGroup[]) {
  if (imp.busy || imp.checking || !kept.length) return;
  imp.busy = true; imp.error = null;
  try {
    const res = await importApi.commit(kept.map((g) => ({ name: g.name.trim(), feeds: ready(g).map((f) => ({ url: f.url, title: f.title })) })));
    imp.committed = res.collections;
    imp.step = 'done';
    api.event('import_committed', { source: imp.preview?.source ?? null, collections: res.collections.length, feeds: res.collections.reduce((n, c) => n + c.added, 0) });
    void loadCollections(true);
  } catch (e) {
    imp.error = e instanceof Error ? e.message : String(e);
  } finally {
    imp.busy = false;
  }
}

export function startOverImport() {
  run++;
  Object.assign(imp, { step: 'choose', preview: null, groups: [], error: null, committed: [], checking: false, retrying: 0, toCheck: 0, checked: 0 });
}
