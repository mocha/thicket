<script lang="ts">
  import { importApi, api, ApiError, IMPORT_CHECK_BATCH, type ImportPreview, type ImportFeed, type ImportCommitted } from '$lib/api';
  import { session } from '$lib/session.svelte';
  import { collectionStore, loadCollections } from '$lib/collections.svelte';

  /**
   * Bringing feeds in from another reader (api/src/lib/importer.ts). Three
   * steps on one page: choose a file or paste a link; review what is in it,
   * folder by folder, while the feeds thicket hasn't seen are checked; then
   * make the collections.
   *
   * Each folder becomes its own collection, side by side, never nested
   * (decided 2026-09-21). The choice offered is which folders to bring and what
   * to call them; individual feeds are sorted out afterwards, inside thicket.
   */
  type Step = 'choose' | 'review' | 'done';
  type Group = { name: string; keep: boolean; open: boolean; feeds: ImportFeed[] };

  let step = $state<Step>('choose');
  let busy = $state(false);
  let error = $state<string | null>(null);
  let link = $state('');
  let fileInput = $state<HTMLInputElement | null>(null);

  let preview = $state<ImportPreview | null>(null);
  let groups = $state<Group[]>([]);
  let checked = $state(0);
  let toCheck = $state(0);
  let checking = $state(false);
  let committed = $state<ImportCommitted[]>([]);
  /** Which reading the checks belong to, so starting over stops the old ones landing on the new list. */
  let run = 0;

  const SHOWN = 12;
  const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'untitled';
  const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };

  $effect(() => { void loadCollections(); });
  /** Worked out here, not taken from the server, so a renamed folder says at once whether it now lands in a collection I already have. */
  const existingBySlug = $derived(new Map(collectionStore.list.filter((c) => c.parentId !== null).map((c) => [c.slug, c])));
  const existingFor = (g: Group) => existingBySlug.get(slugify(g.name)) ?? null;

  const ready = (g: Group) => g.feeds.filter((f) => f.state !== 'failed');
  const refused = (g: Group) => g.feeds.filter((f) => f.state === 'failed');
  const kept = $derived(groups.filter((g) => g.keep && g.name.trim()));
  const keptFeeds = $derived(new Set(kept.flatMap((g) => ready(g).map((f) => f.url))).size);
  const totalFeeds = $derived(new Set(groups.flatMap((g) => g.feeds.map((f) => f.url))).size);

  async function read(get: () => Promise<ImportPreview>, via: string) {
    if (busy) return;
    busy = true; error = null;
    try {
      const p = await get();
      preview = p;
      groups = p.groups.map((g) => ({ name: g.name, keep: true, open: g.feeds.length <= SHOWN, feeds: g.feeds }));
      step = 'review';
      api.event('import_read', { via, source: p.source, groups: p.groups.length, feeds: p.groups.reduce((n, g) => n + g.feeds.length, 0) });
      void checkAll();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
      if (fileInput) fileInput.value = '';
    }
  }

  function onFile(e: Event) {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (file) void read(() => importApi.readFile(file), 'file');
  }

  /** Apply one result everywhere the feed appears: a feed in two folders is one check. */
  function apply(url: string, patch: Partial<ImportFeed>) {
    for (const g of groups) for (const f of g.feeds) if (f.url === url) Object.assign(f, patch);
  }

  /**
   * Check every feed thicket hasn’t seen, in small batches. The server keeps to
   * one request per site at a time; this keeps a few batches in flight, so a
   * thousand-feed file costs a few minutes of patience rather than a burst.
   */
  async function checkAll() {
    const mine = ++run;
    const pending = [...new Set(groups.flatMap((g) => g.feeds.filter((f) => f.state === 'pending').map((f) => f.url)))];
    toCheck = pending.length; checked = 0;
    if (!pending.length) return;
    checking = true;
    const batches: string[][] = [];
    for (let i = 0; i < pending.length; i += IMPORT_CHECK_BATCH) batches.push(pending.slice(i, i + IMPORT_CHECK_BATCH));
    // A few batches in flight, so one slow site doesn't hold up the rest. The server still takes turns per site.
    const lane = async () => {
      for (let b = batches.shift(); b && mine === run; b = batches.shift()) {
        const { results } = await importApi.check(b);
        if (mine !== run) return;
        for (const r of results) {
          apply(r.url, { state: r.state, reason: r.reason, ...(r.title ? { title: r.title } : {}) });
          // The feed has moved and left a redirect behind: follow it at its new address.
          if (r.finalUrl) apply(r.url, { url: r.finalUrl });
        }
        checked += results.length;
      }
    };
    try {
      await Promise.all([lane(), lane(), lane()]);
    } catch (e) {
      if (mine !== run) return;
      // Stopped early (usually: far too much checking in an hour). What wasn't checked is added anyway, and the scheduler finds out.
      const why = e instanceof ApiError ? e.message : 'Checking stopped.';
      for (const g of groups) for (const f of g.feeds) if (f.state === 'pending') Object.assign(f, { state: 'unsure', reason: `Not checked (${why}) It’s added anyway and will be tried.` });
    } finally {
      if (mine === run) checking = false;
    }
  }

  async function commit() {
    if (busy || checking || !kept.length) return;
    busy = true; error = null;
    try {
      const res = await importApi.commit(kept.map((g) => ({ name: g.name.trim(), feeds: ready(g).map((f) => ({ url: f.url, title: f.title })) })));
      committed = res.collections;
      step = 'done';
      api.event('import_committed', { source: preview?.source ?? null, collections: res.collections.length, feeds: res.collections.reduce((n, c) => n + c.added, 0) });
      void loadCollections(true);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  function startOver() {
    run++;
    step = 'choose'; preview = null; groups = []; error = null; link = ''; committed = [];
  }

  const label = (f: ImportFeed) => f.title?.trim() || host(f.url);
</script>

<svelte:head><title>Import · thicket</title></svelte:head>

<header class="top">
  <a class="back" href="/settings">‹ Settings</a>
  <h1>Bring your feeds in</h1>
</header>

{#if step === 'choose'}
  <section class="card">
    <h2>From another reader</h2>
    <p class="help">
      Most readers can save your subscriptions as an <strong>OPML</strong> file. In Feedly, it’s under
      <em>Organize Sources → Export OPML</em> (on the web, not in the app). Each folder in the file becomes a
      collection here, and you choose which ones to bring before anything is added.
    </p>
    <div class="row">
      <button class="btn primary" onclick={() => fileInput?.click()} disabled={busy}>{busy ? 'Reading…' : 'Choose a file'}</button>
      <input bind:this={fileInput} type="file" accept=".opml,.xml,text/x-opml,text/xml,application/xml" onchange={onFile} hidden />
    </div>
  </section>

  <section class="card">
    <h2>From a link</h2>
    <p class="help">Paste a collection’s address from any thicket, or a link to an OPML file.</p>
    <form class="linkrow" onsubmit={(e) => { e.preventDefault(); if (link.trim()) void read(() => importApi.readLink(link.trim()), 'link'); }}>
      <input type="url" bind:value={link} placeholder="https://…" aria-label="Link to a collection or OPML file" />
      <button class="btn" type="submit" disabled={busy || !link.trim()}>{busy ? 'Reading…' : 'Read'}</button>
    </form>
  </section>

  {#if error}<p class="bad" role="alert">{error}</p>{/if}
{:else if step === 'review' && preview}
  <p class="lede">
    {preview.source ? `From ${preview.source}: ` : ''}{groups.length} {groups.length === 1 ? 'folder' : 'folders'}, {totalFeeds} {totalFeeds === 1 ? 'feed' : 'feeds'}.
    Each folder you keep becomes a collection. You can rename them here, and sort out individual feeds once they’re in.
  </p>
  {#if preview.emptyFolders.length}
    <p class="fine">Left out, because they’re empty: {preview.emptyFolders.join(', ')}.</p>
  {/if}

  {#if checking || toCheck}
    <div class="progress" aria-live="polite">
      <div class="bar"><span style="width: {toCheck ? Math.round((checked / toCheck) * 100) : 100}%"></span></div>
      <span>{checking ? `Checking feeds… ${checked} of ${toCheck}` : `Checked ${toCheck} ${toCheck === 1 ? 'feed' : 'feeds'} thicket hadn’t seen before.`}</span>
    </div>
  {/if}

  {#each groups as g, gi (gi)}
    {@const ok = ready(g)}
    {@const bad = refused(g)}
    {@const into = existingFor(g)}
    <section class="card group" class:off={!g.keep}>
      <div class="ghead">
        <label class="keep"><input type="checkbox" bind:checked={g.keep} aria-label="Bring in {g.name}" /></label>
        <div class="gname">
          <input class="name" bind:value={g.name} disabled={!g.keep} aria-label="Collection name" />
          <small>
            {#if into}Adds to your collection <strong>{into.name}</strong>{:else}New collection{/if}
            · {ok.length} to add{#if bad.length} · {bad.length} can’t be added{/if}
          </small>
        </div>
      </div>

      {#if g.keep}
        {#if ok.length}
          <ul class="feeds">
            {#each g.open ? ok : ok.slice(0, SHOWN) as f (f.url)}
              <li>
                <span class="fname">{label(f)}<small>{host(f.url)}</small></span>
                {#if f.state === 'pending'}<span class="tag wait">Checking…</span>
                {:else if f.state === 'unsure'}<span class="tag unsure" title={f.reason ?? ''}>Will retry</span>
                {:else if f.following}<span class="tag">Following</span>
                {:else}<span class="tag good">Ready</span>{/if}
              </li>
              {#if f.state === 'unsure' && f.reason}<li class="why">{f.reason}</li>{/if}
            {/each}
          </ul>
          {#if !g.open && ok.length > SHOWN}
            <button class="more" onclick={() => (g.open = true)}>Show all {ok.length}</button>
          {/if}
        {/if}

        {#if bad.length}
          <h3>Can’t be added</h3>
          <ul class="feeds refused">
            {#each bad as f (f.url)}
              <li>
                <span class="fname">{label(f)}<small>{host(f.url)}</small></span>
                <span class="reason">{f.reason}</span>
              </li>
            {/each}
          </ul>
        {/if}
      {/if}
    </section>
  {/each}

  {#if error}<p class="bad" role="alert">{error}</p>{/if}

  <div class="footer">
    <button class="btn" onclick={startOver} disabled={busy}>Start over</button>
    <button class="btn primary" onclick={commit} disabled={busy || checking || !kept.length || !keptFeeds}>
      {#if busy}Bringing them in…
      {:else if checking}Checking feeds…
      {:else}Bring in {kept.length} {kept.length === 1 ? 'collection' : 'collections'}, {keptFeeds} {keptFeeds === 1 ? 'feed' : 'feeds'}{/if}
    </button>
  </div>
{:else if step === 'done'}
  <section class="card">
    <h2>Done</h2>
    <p class="help">New feeds start arriving over the next few minutes, as thicket fetches each one for the first time.</p>
    <ul class="feeds">
      {#each committed as c (c.id)}
        <li>
          <a class="fname" href="/@{session.user?.handle}/collections/{c.slug}">{c.name}<small>{c.created ? 'New collection' : 'Added to your collection'}</small></a>
          <span class="count">{c.added} added{#if c.alreadyThere} · {c.alreadyThere} already there{/if}</span>
        </li>
      {/each}
    </ul>
    <div class="row"><button class="btn" onclick={startOver}>Import another</button></div>
  </section>
{/if}

<style>
  .top { margin-bottom: 14px; }
  .back { display: inline-flex; font-size: calc(14px * var(--size-app)); font-weight: 600; color: var(--accent); padding: 4px 0; }
  h1 { font-family: var(--font-headings); font-size: calc(28px * var(--size-headings)); margin: 2px 0 0; }
  .card { background: var(--surface); border-radius: var(--radius); box-shadow: var(--shadow); padding: 16px; margin-bottom: 14px; }
  h2 { font-size: calc(20px * var(--size-app)); margin: 0 0 12px; line-height: 1.25; }
  h2 + .help { margin-top: -8px; }
  h3 { font-size: calc(14px * var(--size-app)); margin: 16px 0 8px; color: var(--text-2); }
  .help { margin: 0 0 12px; font-size: calc(14px * var(--size-app)); color: var(--text-3); line-height: 1.45; max-width: 66ch; }
  .lede { margin: 0 0 10px; color: var(--text-2); line-height: 1.45; max-width: 66ch; }
  .fine { margin: 0 0 12px; font-size: calc(13px * var(--size-app)); color: var(--text-3); }
  .row { display: flex; justify-content: flex-end; }
  .btn { padding: 9px 14px; border-radius: 999px; border: 1px solid var(--line); background: var(--surface); font-size: calc(14px * var(--size-app)); font-weight: 600; color: var(--text-2); }
  .btn.primary { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
  .btn:disabled { opacity: 0.5; }
  .linkrow { display: flex; gap: 8px; }
  .linkrow input { flex: 1; min-width: 0; padding: 10px 12px; border-radius: 12px; border: 1px solid var(--line); background: var(--bg); color: var(--text); font: inherit; font-size: calc(16px * var(--size-app)); }
  input:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
  .bad { color: var(--danger); margin: 0 0 14px; font-size: calc(14px * var(--size-app)); }

  .progress { display: flex; flex-direction: column; gap: 6px; margin: 0 0 14px; font-size: calc(13px * var(--size-app)); color: var(--text-3); }
  .bar { height: 6px; border-radius: 999px; background: var(--line); overflow: hidden; }
  .bar span { display: block; height: 100%; background: var(--accent); transition: width 200ms ease; }

  .group.off { opacity: 0.6; }
  .ghead { display: flex; gap: 12px; align-items: flex-start; }
  .keep input { width: 20px; height: 20px; margin-top: 8px; accent-color: var(--accent); }
  .gname { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
  .name { font-size: calc(18px * var(--size-app)); font-weight: 700; padding: 6px 8px; margin-left: -8px; border-radius: 8px; border: 1px solid transparent; background: transparent; color: var(--text); font-family: inherit; width: 100%; }
  .name:hover:not(:disabled) { border-color: var(--line); }
  .gname small { font-size: calc(13px * var(--size-app)); color: var(--text-3); }

  .feeds { list-style: none; margin: 12px 0 0; padding: 0; border: 1px solid var(--line); border-radius: 12px; }
  .feeds li { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-top: 1px solid var(--line); font-size: calc(14px * var(--size-app)); }
  .feeds li:first-child { border-top: 0; }
  .feeds li.why { border-top: 0; padding-top: 0; font-size: calc(12px * var(--size-app)); color: var(--text-3); }
  .fname { flex: 1; min-width: 0; display: flex; flex-direction: column; font-weight: 600; overflow-wrap: anywhere; color: var(--text); }
  .fname small { font-weight: 400; font-size: calc(12px * var(--size-app)); color: var(--text-3); }
  .tag { flex: none; font-size: calc(12px * var(--size-app)); font-weight: 600; color: var(--text-3); padding: 2px 8px; border-radius: 999px; border: 1px solid var(--line); }
  .tag.good { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 40%, transparent); }
  .tag.unsure { color: var(--text-2); border-style: dashed; }
  .tag.wait { border-color: transparent; }
  .refused { border-color: color-mix(in srgb, var(--danger) 30%, var(--line)); }
  .refused li { align-items: flex-start; }
  .reason { flex: 1.2; min-width: 0; font-size: calc(13px * var(--size-app)); color: var(--text-2); }
  .count { flex: none; font-size: calc(13px * var(--size-app)); color: var(--text-3); }
  .more { margin-top: 8px; font-size: calc(14px * var(--size-app)); font-weight: 600; color: var(--accent); }

  .footer { position: sticky; bottom: calc(12px + var(--safe-b, 0px)); display: flex; justify-content: flex-end; gap: 8px; padding: 10px 12px; margin-top: 4px; background: var(--surface); border-radius: 999px; box-shadow: var(--shadow); }
  @media (max-width: 520px) { .refused li { flex-direction: column; gap: 4px; } }
</style>
