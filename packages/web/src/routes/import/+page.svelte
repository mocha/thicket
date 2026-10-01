<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { importApi } from '$lib/api';
  import { session } from '$lib/session.svelte';
  import { collectionStore, loadCollections } from '$lib/collections.svelte';
  import { showToast } from '$lib/toast.svelte';
  import { imp, readImport, commitImport, startOverImport, ready, refused, settled, canKeep, SHOWN, type ImportGroup } from '$lib/importer.svelte';
  import type { ImportFeed } from '$lib/api';
  import ImportHelp from '$lib/components/ImportHelp.svelte';
  import Input from '$lib/components/Input.svelte';
  import Button from '$lib/components/Button.svelte';

  /**
   * Bringing feeds in from another reader (api/src/lib/importer.ts). Three
   * steps on one page: choose a file or paste a link; review what is in it,
   * folder by folder, while the feeds thicket hasn't seen are checked; then
   * make the collections. The import itself lives in lib/importer, so one
   * started in the first-run setup arrives here already under way.
   *
   * Each folder becomes its own collection, side by side, never nested
   * (decided 2026-09-21). The choice offered is which folders to bring and what
   * to call them; individual feeds are sorted out afterwards, inside thicket.
   */
  let link = $state('');

  const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'untitled';
  const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };

  // A finished import is over: coming back here starts a new one.
  onMount(() => { if (imp.step === 'done') startOverImport(); });
  $effect(() => { void loadCollections(); });
  $effect(() => {
    for (const g of imp.groups) if (g.keep && settled(g) && !canKeep(g)) g.keep = false;
  });

  /**
   * Turning one back on is refused while nothing in it works, and says which
   * kind of nothing: a folder of dead addresses is the reader's history, but a
   * folder that is all "couldn't check" usually means the connection here is
   * bad, not that the feeds are — and that is worth saying out loud, because
   * the two look identical on the page.
   */
  function toggleKeep(g: ImportGroup, e: Event) {
    const el = e.currentTarget as HTMLInputElement;
    if (el.checked && !canKeep(g)) {
      el.checked = false;
      const name = g.name.trim() || 'this folder';
      showToast(!settled(g)
        ? `Still checking the feeds in “${name}” — give it a moment.`
        : g.feeds.some((f) => f.state === 'unsure')
          ? `None of the feeds in “${name}” could be checked just now, which usually means the connection here is having trouble rather than the sites.`
          : `Nothing in “${name}” can be added, so there’s no collection to make.`);
      return;
    }
    g.keep = el.checked;
  }

  /**
   * What each kept group will actually be called. An import always makes new
   * collections, so a name I already have is numbered past rather than merged
   * into: "Videos", "Videos 1", "Videos 2". Worked out here rather than taken
   * from the server, so renaming a folder says at once what it will become;
   * the server applies the same rule and has the last word.
   */
  const finalNames = $derived.by(() => {
    const taken = new Set(collectionStore.list.filter((c) => c.parentId !== null).map((c) => c.slug));
    const out = new Map<number, string>();
    imp.groups.forEach((g, i) => {
      const base = g.name.trim();
      if (!g.keep || !base) return;
      let name = base;
      for (let n = 1; taken.has(slugify(name)); n++) name = `${base} ${n}`;
      taken.add(slugify(name));
      out.set(i, name);
    });
    return out;
  });

  const kept = $derived(imp.groups.filter((g) => g.keep && g.name.trim() && canKeep(g)));
  const keptFeeds = $derived(new Set(kept.flatMap((g) => ready(g).map((f) => f.url))).size);
  const totalFeeds = $derived(new Set(imp.groups.flatMap((g) => g.feeds.map((f) => f.url))).size);

  function startOver() { startOverImport(); link = ''; }

  const label = (f: ImportFeed) => f.title?.trim() || host(f.url);
</script>

<svelte:head><title>Import · thicket</title></svelte:head>

<header class="top">
  <h1>Import your feeds</h1>
</header>

{#if imp.step === 'choose'}
  <section class="card">
    <h2>From another reader</h2>
    <ImportHelp via="file" errors={false} />
  </section>

  <section class="card">
    <h2>From a link</h2>
    <p class="help">Paste a link to someone else’s collection, or to an OPML file</p>
    <form class="linkrow" onsubmit={(e) => { e.preventDefault(); if (link.trim()) void readImport(() => importApi.readLink(link.trim()), 'link'); }}>
      <Input type="url" inputmode="url" inset bind:value={link} placeholder="{page.url.host}/@name/collections/…" aria-label="Link to a collection or OPML file" class="link" />
      <Button variant="primary" size="lg" type="submit" disabled={!link.trim()} loading={imp.busy}>Preview</Button>
    </form>
  </section>

  {#if imp.error}<p class="bad" role="alert">{imp.error}</p>{/if}
{:else if imp.step === 'review' && imp.preview}
  <p class="lede">
    {imp.preview.source ? `From ${imp.preview.source}: ` : ''}{imp.groups.length} {imp.groups.length === 1 ? 'folder' : 'folders'}, {totalFeeds} {totalFeeds === 1 ? 'feed' : 'feeds'}.
    Each folder you keep becomes a collection. You can rename them here, and sort out individual feeds once they’re in.
  </p>
  {#if imp.preview.emptyFolders.length}
    <p class="fine">Left out, because they’re empty: {imp.preview.emptyFolders.join(', ')}.</p>
  {/if}

  {#if imp.checking || imp.toCheck}
    <!-- The bar says how far along it is to anyone who asks; the count beside it
         ticks up once per feed, which is too much to read out, so only each
         change of stage is announced (the hidden line below). -->
    <div class="progress">
      <div class="bar" role="progressbar" aria-label="Checking feeds" aria-valuemin={0} aria-valuemax={imp.toCheck || 1} aria-valuenow={imp.toCheck ? imp.checked : 1}><span style="width: {imp.toCheck ? Math.round((imp.checked / imp.toCheck) * 100) : 100}%"></span></div>
      <span class="visually-hidden" role="status">
        {#if imp.retrying}Trying {imp.retrying} {imp.retrying === 1 ? 'feed' : 'feeds'} again that didn’t answer.
        {:else if imp.checking}Checking {imp.toCheck} {imp.toCheck === 1 ? 'feed' : 'feeds'}.
        {:else}Checked {imp.toCheck} {imp.toCheck === 1 ? 'feed' : 'feeds'} thicket hadn’t seen before.{/if}
      </span>
      <span aria-hidden="true">
        {#if imp.retrying}Trying {imp.retrying} {imp.retrying === 1 ? 'feed' : 'feeds'} again that didn’t answer… {imp.checked} of {imp.toCheck}
        {:else if imp.checking}Checking feeds… {imp.checked} of {imp.toCheck}
        {:else}Checked {imp.toCheck} {imp.toCheck === 1 ? 'feed' : 'feeds'} thicket hadn’t seen before.{/if}
      </span>
    </div>
  {/if}

  {#each imp.groups as g, gi (gi)}
    {@const ok = ready(g)}
    {@const bad = refused(g)}
    {@const renamed = g.keep && !!g.name.trim() && finalNames.get(gi) !== g.name.trim()}
    {@const blocked = settled(g) && !canKeep(g)}
    <section class="card group" class:off={!g.keep}>
      <div class="ghead">
        <label class="keep">
          <input type="checkbox" checked={g.keep} onchange={(e) => toggleKeep(g, e)} />
          <span>Create this collection</span>
        </label>
        <div class="gname">
          <input class="name" bind:value={g.name} disabled={!g.keep} aria-label="Collection name" />
          <small>
            {#if blocked}{g.feeds.some((f) => f.state === 'unsure') ? 'None of these could be checked' : 'Nothing here can be added'}{:else if renamed}Created as <strong>{finalNames.get(gi)}</strong>, beside the <strong>{g.name.trim()}</strong> you already have{:else}New collection{/if}
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
                {:else if f.following}<span class="tag">Already Following</span>
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

  {#if imp.error}<p class="bad" role="alert">{imp.error}</p>{/if}

  <div class="footer">
    <Button onclick={startOver} disabled={imp.busy}>Choose a different file</Button>
    <Button variant="primary" onclick={() => commitImport(kept)} disabled={imp.busy || imp.checking || !kept.length || !keptFeeds}>
      {#if imp.busy}Bringing them in…
      {:else if imp.checking}Checking feeds…
      {:else}Bring in {kept.length} {kept.length === 1 ? 'collection' : 'collections'}, {keptFeeds} {keptFeeds === 1 ? 'feed' : 'feeds'}{/if}
    </Button>
  </div>
{:else if imp.step === 'done'}
  <section class="card">
    <h2>Done</h2>
    <p class="help">New feeds start arriving over the next few minutes, as thicket fetches each one for the first time.</p>
    <ul class="feeds">
      {#each imp.committed as c (c.id)}
        <li>
          <a class="fname" href="/@{session.user?.handle}/collections/{c.slug}">{c.name}<small>{c.renamedFrom ? `Beside your existing “${c.renamedFrom}”` : 'New collection'}</small></a>
          <span class="count">{c.added} added</span>
        </li>
      {/each}
    </ul>
    <div class="row"><Button onclick={startOver}>Import another</Button></div>
  </section>
{/if}

<style>
  .top { margin-bottom: 14px; }
    h1 { font-family: var(--font-headings); font-size: calc(28px * var(--size-headings)); margin: 2px 0 0; }
  .card { background: var(--surface); border-radius: var(--radius); box-shadow: var(--shadow); padding: 16px; margin-bottom: 14px; }
  h2 { font-size: calc(20px * var(--size-app)); margin: 0 0 12px; line-height: 1.25; }
  h2 + .help { margin-top: -8px; }
  h3 { font-size: calc(14px * var(--size-app)); margin: 16px 0 8px; color: var(--text-2); }
  .help { margin: 0 0 12px; font-size: calc(14px * var(--size-app)); color: var(--text-2); line-height: 1.45; max-width: 66ch; }
  .lede { margin: 0 0 10px; color: var(--text-2); line-height: 1.45; max-width: 66ch; }
  .fine { margin: 0 0 12px; font-size: calc(13px * var(--size-app)); color: var(--text-2); }
  .row { display: flex; justify-content: flex-end; margin-top: var(--space-4); }
  .linkrow { display: flex; align-items: center; gap: var(--space-2); }
  .linkrow :global(.link) { flex: 1; min-width: 0; }
  input:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
  .bad { color: var(--danger); margin: 0 0 14px; font-size: calc(14px * var(--size-app)); }

  .progress { display: flex; flex-direction: column; gap: 6px; margin: 0 0 14px; font-size: calc(13px * var(--size-app)); color: var(--text-2); }
  .bar { height: 6px; border-radius: 999px; background: var(--line); overflow: hidden; }
  .bar span { display: block; height: 100%; background: var(--accent); transition: width 200ms ease; }

  .group.off { opacity: 0.6; }
  .ghead { display: flex; flex-direction: column; gap: 10px; }
  .keep { display: flex; align-items: center; gap: 8px; font-size: calc(14px * var(--size-app)); font-weight: 600; color: var(--text-2); cursor: pointer; }
  .keep input { width: 20px; height: 20px; margin: 0; flex: none; accent-color: var(--accent); }
  .gname { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
  .name { font-size: calc(18px * var(--size-app)); font-weight: 700; padding: 6px 8px; margin-left: -8px; border-radius: 8px; border: 1px solid var(--field-line); background: transparent; color: var(--text); font-family: inherit; width: 100%; }
  /* A folder that's switched off isn't being named, so its box goes back to plain text. */
  .name:disabled { border-color: transparent; }
  .gname small { font-size: calc(13px * var(--size-app)); color: var(--text-2); }

  .feeds { list-style: none; margin: 12px 0 0; padding: 0; border: 1px solid var(--line); border-radius: 12px; }
  .feeds li { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-top: 1px solid var(--line); font-size: calc(14px * var(--size-app)); }
  .feeds li:first-child { border-top: 0; }
  .feeds li.why { border-top: 0; padding-top: 0; font-size: calc(12px * var(--size-app)); color: var(--text-2); }
  .fname { flex: 1; min-width: 0; display: flex; flex-direction: column; font-weight: 600; overflow-wrap: anywhere; color: var(--text); }
  .fname small { font-weight: 400; font-size: calc(12px * var(--size-app)); color: var(--text-2); }
  .tag { flex: none; font-size: calc(12px * var(--size-app)); font-weight: 600; color: var(--text-2); padding: 2px 8px; border-radius: 999px; border: 1px solid var(--line); }
  .tag.good { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 40%, transparent); }
  .tag.unsure { color: var(--text-2); border-style: dashed; }
  .tag.wait { border-color: transparent; }
  .refused { border-color: color-mix(in srgb, var(--danger) 30%, var(--line)); }
  .refused li { align-items: flex-start; }
  .reason { flex: 1.2; min-width: 0; font-size: calc(13px * var(--size-app)); color: var(--text-2); }
  .count { flex: none; font-size: calc(13px * var(--size-app)); color: var(--text-2); }
  .more { margin-top: 8px; font-size: calc(14px * var(--size-app)); font-weight: 600; color: var(--accent); }

  /* Pinned to the bottom while a long review scrolls, so the main action is always in reach. On a
     phone it sits on top of the tab bar; from 900px up there is no tab bar. */
  .footer {
    position: sticky; bottom: calc(var(--nav-h) + var(--safe-b, 0px)); z-index: 5;
    display: flex; justify-content: flex-end; gap: var(--space-2);
    padding: var(--space-3) 0; margin-top: var(--space-2);
    background: var(--bg);
  }
  @media (min-width: 900px) { .footer { bottom: 0; padding-bottom: calc(var(--space-3) + var(--safe-b, 0px)); } }
  @media (max-width: 520px) {
    .refused li { flex-direction: column; gap: 4px; }
    /* Two long labels don't fit side by side on a phone: stack them, main action on top. */
    .footer { flex-direction: column-reverse; }
  }
</style>
