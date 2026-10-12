<script lang="ts">
  import Badge from '$lib/components/Badge.svelte';
  import Card from '$lib/components/Card.svelte';
  import Dot from '$lib/components/Dot.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import { onMount, tick } from 'svelte';
  import { page } from '$app/state';
  import { importApi } from '$lib/api';
  import { session } from '$lib/session.svelte';
  import { collectionStore, loadCollections } from '$lib/collections.svelte';
  import { imp, readImport, commitImport, startOverImport, ready, refused, settled, canKeep, SHOWN, type ImportGroup } from '$lib/importer.svelte';
  import type { ImportFeed } from '$lib/api';
  import ImportHelp from '$lib/components/ImportHelp.svelte';
  import Input from '$lib/components/Input.svelte';
  import Button from '$lib/components/Button.svelte';

  /**
   * Bringing feeds in from another reader (api/src/lib/importer.ts). Three
   * steps on one page: choose a file or paste a link; review what is in it,
   * group by group, while the feeds thicket hasn't seen are checked; then
   * make the collections. The import itself lives in lib/importer, so one
   * started in the first-run setup arrives here already under way.
   *
   * Each group becomes its own collection, side by side, never nested
   * (decided 2026-09-21). The choice offered is which groups to bring and what
   * to call them; individual feeds are sorted out afterwards, inside thicket.
   */
  let link = $state('');

  const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'untitled';
  const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };

  // A finished import is over: coming back here starts a new one.
  onMount(() => { if (imp.step === 'done') startOverImport(); });
  $effect(() => { void loadCollections(); });

  /**
   * Why a group can't become a collection, said on the card itself, in one of
   * two ways: a group of dead addresses is the old reader's history, but one
   * that is all "couldn't check" usually means the connection here is bad, not
   * the feeds — and the two would otherwise look identical. Null while there
   * is still something in it that works, or might.
   */
  function blockedReason(g: ImportGroup): string | null {
    if (!settled(g) || canKeep(g)) return null;
    const n = g.feeds.length;
    return refused(g).length === n
      ? `None of ${n === 1 ? 'this feed works' : n === 2 ? 'these 2 feeds work' : `these ${n} feeds work`}, so thicket won’t create this collection`
      : `Thicket couldn’t check any of ${n === 1 ? 'this feed' : `these ${n} feeds`} just now, so it won’t create this collection. That usually means a connection problem here, not with the sites.`;
  }

  /**
   * What each kept group will actually be called. An import always makes new
   * collections, so a name I already have is numbered past rather than merged
   * into: "Videos", "Videos 1", "Videos 2". Worked out here rather than taken
   * from the server, so renaming a group says at once what it will become;
   * the server applies the same rule and has the last word.
   */
  const finalNames = $derived.by(() => {
    const taken = new Set(collectionStore.list.filter((c) => c.parentId !== null).map((c) => c.slug));
    const out = new Map<number, string>();
    imp.groups.forEach((g, i) => {
      const base = g.name.trim();
      if (!g.keep || !base || (settled(g) && !canKeep(g))) return;
      let name = base;
      for (let n = 1; taken.has(slugify(name)); n++) name = `${base} ${n}`;
      taken.add(slugify(name));
      out.set(i, name);
    });
    return out;
  });

  const kept = $derived(imp.groups.filter((g) => g.keep && g.name.trim() && canKeep(g)));
  /* Only feeds I don't already follow count as new: one I follow is just filed again. */
  const newFeeds = (g: ImportGroup) => ready(g).filter((f) => !f.following);
  const keptNew = $derived(new Set(kept.flatMap((g) => newFeeds(g).map((f) => f.url))).size);
  const totalFeeds = $derived(new Set(imp.groups.flatMap((g) => g.feeds.map((f) => f.url))).size);
  /* With a single group there is nothing to choose between, so no box to untick. */
  const choosing = $derived(imp.groups.length > 1);

  function startOver() { startOverImport(); link = ''; }

  /* A file often gives the address itself as a feed's name; the site's name says it better. */
  const label = (f: ImportFeed) => { const t = f.title?.trim(); return t && !/^https?:\/\//i.test(t) ? t : host(f.url); };

  /**
   * Renaming is one card at a time: Rename swaps the title for the shared text
   * box, and pressing Enter, Escape or leaving the box puts the title back.
   * Escape, or leaving it empty, keeps the name it had.
   */
  let renaming = $state<number | null>(null);
  let before = '';
  let nameBox = $state<HTMLInputElement | null>(null);
  async function startRename(gi: number) {
    before = imp.groups[gi].name;
    renaming = gi;
    await tick();
    nameBox?.focus();
    nameBox?.select();
  }
  function finishRename(g: ImportGroup) {
    if (!g.name.trim()) g.name = before;
    renaming = null;
  }
</script>

<svelte:head><title>Import · thicket</title></svelte:head>

<PageHeader name="Import your feeds">
  {#snippet description()}Bring the feeds you follow from another reader.{/snippet}
</PageHeader>

{#if imp.step === 'choose'}
  <Card kind="section" as="section" class="import-section">
    <h2 class="section-title">From another reader</h2>
    <ImportHelp via="file" errors={false} />
  </Card>

  <Card kind="section" as="section" class="import-section">
    <h2 class="section-title">From a link</h2>
    <p class="section-description">Paste a link to someone else’s collection, or to an OPML file</p>
    <form class="linkrow" onsubmit={(e) => { e.preventDefault(); if (link.trim()) void readImport(() => importApi.readLink(link.trim()), 'link'); }}>
      <Input type="url" inputmode="url" inset bind:value={link} placeholder="{page.url.host}/@name/collections/…" aria-label="Link to a collection or OPML file" class="link" />
      <Button variant="primary" size="lg" type="submit" disabled={!link.trim()} loading={imp.busy}>Preview</Button>
    </form>
  </Card>

  {#if imp.error}<p class="bad" role="alert">{imp.error}</p>{/if}
{:else if imp.step === 'review' && imp.preview}
  <!-- With one group the card below already says it all, so the line only explains the checkboxes. -->
  {#if choosing}
    <p class="lede">
      {imp.preview.source ? `From ${imp.preview.source}: ` : ''}{imp.groups.length} groups, {totalFeeds} {totalFeeds === 1 ? 'feed' : 'feeds'}. Each group becomes a new collection. Untick any you don’t want.
    </p>
  {/if}
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
    {@const fresh = newFeeds(g).length}
    {@const following = ok.length - fresh}
    {@const final = finalNames.get(gi)}
    {@const renamed = !!final && final !== g.name.trim()}
    {@const why = blockedReason(g)}
    {@const on = g.keep && !why}
    <Card kind="section" as="section" class="import-section {on ? '' : 'off'}">
      <div class="ghead">
        {#if choosing}
          <!-- A group with nothing that works can't be ticked; the line below says why. -->
          <input type="checkbox" class="keep" checked={on} disabled={!!why} onchange={(e) => (g.keep = e.currentTarget.checked)} aria-label="Create {g.name.trim() || 'this collection'}" />
        {/if}
        {#if on && renaming === gi}
          <form class="rename" onsubmit={(e) => { e.preventDefault(); finishRename(g); }}>
            <Input bind:value={g.name} bind:element={nameBox} clearable={false} aria-label="Collection name" onblur={() => finishRename(g)} onkeydown={(e: KeyboardEvent) => { if (e.key === 'Escape') { g.name = before; finishRename(g); } }} />
          </form>
        {:else}
          <h2 class="section-title gtitle">{g.name.trim() || 'Untitled'}</h2>
          {#if on}<Button size="sm" onclick={() => startRename(gi)}>Rename</Button>{/if}
        {/if}
      </div>
      <div class="notes">
        {#if why}<p class="note">{why}</p>
        {:else if on}
          {#if renamed}<p class="note">Will be called “{final}”, since you already have a {g.name.trim()}</p>{/if}
          <p class="note counts">
            {#if !settled(g) && !ok.length}Checking feeds…{:else}{fresh} new{/if}{#if following}{' '}<Dot />{' '}{following} you already follow{/if}{#if bad.length}{' '}<Dot />{' '}{bad.length} we can’t import{/if}
          </p>
        {/if}
      </div>

      {#if on || why || !choosing}
        {@const rows = [...ok, ...bad]}
        <div class="feeds">
        <ul class="list-rows">
          {#each g.open ? rows : rows.slice(0, SHOWN) as f (f.url)}
            {@const name = label(f)}
            <li class:refused={f.state === 'failed'}>
              <span class="fname">
                <span class="row-name">{name}</span>
                {#if name !== host(f.url)}<small class="row-details">{host(f.url)}</small>{/if}
                {#if f.reason && (f.state === 'failed' || f.state === 'unsure')}<small class="row-details reason">{f.reason}</small>{/if}
              </span>
              {#if f.state === 'pending'}<Badge>Checking…</Badge>
              {:else if f.state === 'failed'}<Badge tone="danger">Can’t import</Badge>
              {:else if f.state === 'unsure'}<Badge>Will retry</Badge>
              {:else if f.following}<Badge>Already following</Badge>
              {:else}<Badge tone="soft">Ready</Badge>{/if}
            </li>
          {/each}
        </ul>
        {#if !g.open && rows.length > SHOWN}
          <button class="row-more tap" onclick={() => (g.open = true)}>Show all {rows.length}</button>
        {/if}
        </div>
      {/if}
    </Card>
  {/each}

  {#if imp.error}<p class="bad" role="alert">{imp.error}</p>{/if}

  <div class="footer">
    <Button onclick={startOver} disabled={imp.busy}>Choose a different file</Button>
    <Button variant="primary" onclick={() => commitImport(kept)} disabled={imp.busy || imp.checking || !kept.length}>
      {#if imp.busy}Bringing them in…
      {:else if imp.checking}Checking feeds…
      {:else}Bring in {kept.length} {kept.length === 1 ? 'collection' : 'collections'}{#if keptNew}, {keptNew} new {keptNew === 1 ? 'feed' : 'feeds'}{/if}{/if}
    </Button>
  </div>
{:else if imp.step === 'done'}
  <Card kind="section" as="section" class="import-section">
    <h2 class="section-title">Done</h2>
    <p class="section-description">New feeds start arriving over the next few minutes, as thicket fetches each one for the first time.</p>
    <ul class="feeds list-rows">
      {#each imp.committed as c (c.id)}
        <li>
          <a class="fname row-name" href="/@{session.user?.handle}/collections/{c.slug}">{c.name}<small class="row-details">{c.renamedFrom ? `Beside your existing “${c.renamedFrom}”` : 'New collection'}</small></a>
          <span class="count">{c.added} added</span>
        </li>
      {/each}
    </ul>
    <div class="row"><Button onclick={startOver}>Import another</Button></div>
  </Card>
{/if}

<style>
  /* The room between sections is set on the cards' own class, since the cards are drawn by the shared Card. */
  :global(.import-section) { margin-bottom: var(--space-4); }
  .lede { margin: 0 0 var(--space-3); color: var(--text-2); line-height: 1.45; max-width: 66ch; }
  .fine { margin: 0 0 var(--space-3); font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); }
  .row { display: flex; justify-content: flex-end; margin-top: var(--space-4); }
  .linkrow { display: flex; align-items: center; gap: var(--space-2); }
  .linkrow :global(.link) { flex: 1; min-width: 0; }
  .bad { color: var(--danger); margin: 0 0 var(--space-4); font-size: calc(var(--text-sm) * var(--size-app)); }

  .progress { display: flex; flex-direction: column; gap: var(--space-2); margin: 0 0 var(--space-4); font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); }
  .bar { height: 6px; border-radius: var(--radius-pill); background: var(--line); overflow: hidden; }
  .bar span { display: block; height: 100%; background: var(--accent); transition: width 200ms ease; }

  .ghead { display: flex; align-items: center; gap: var(--space-3); min-height: 40px; }
  .keep { width: 20px; height: 20px; margin: 0; flex: none; accent-color: var(--accent); cursor: pointer; }
  .keep:disabled { cursor: not-allowed; }
  .keep:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  /* The card's own title, without the room it usually leaves below: the notes sit tight under it. */
  .ghead :global(.gtitle) { flex: 1; min-width: 0; margin: 0; overflow-wrap: anywhere; }
  :global(.import-section.off) .gtitle { color: var(--text-2); }
  .rename { flex: 1; min-width: 0; }
  /* The notes line up with the title's first letter, past the checkbox when there is one. */
  .notes { display: flex; flex-direction: column; gap: var(--space-1); margin-top: var(--space-1); }
  .ghead:has(.keep) + .notes { padding-left: calc(20px + var(--space-3)); }
  .note { margin: 0; font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); }
  .counts { font-variant-numeric: tabular-nums; }

  /* The feeds run edge to edge across the card, so each row's text starts the
     card's own inset in, as on every other list of rows. Lines only between rows;
     the list runs to the card's bottom edge. */
  .feeds { margin: var(--space-3) calc(-1 * var(--card-pad)) calc(-1 * var(--card-pad)); }
  .feeds li { display: flex; align-items: center; gap: var(--space-3); }
  .fname { flex: 1; min-width: 0; display: flex; flex-direction: column; overflow-wrap: anywhere; }
  /* A feed we can't import is quieter than the ones that will come in. */
  .refused .row-name { font-weight: 400; color: var(--text-2); }
  .reason { margin-top: var(--space-1); }
  .count { flex: none; font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); }

  /* Pinned to the bottom while a long review scrolls, so the main action is always in reach. On a
     phone it sits on top of the tab bar; where the sidebar shows there is no tab bar. */
  .footer {
    position: sticky; bottom: calc(var(--nav-h) + var(--safe-b, 0px)); z-index: 5;
    display: flex; justify-content: flex-end; gap: var(--space-2);
    padding: var(--space-3) 0; margin-top: var(--space-2);
    background: var(--bg);
  }
  @media (min-width: 900px) and (min-height: 501px), (min-width: 900px) and (pointer: fine) { .footer { bottom: 0; padding-bottom: calc(var(--space-3) + var(--safe-b, 0px)); } }
  @media (max-width: 520px) {
    /* Two long labels don't fit side by side on a phone: stack them, main action on top. */
    .footer { flex-direction: column-reverse; }
  }
</style>
