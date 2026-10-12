<script lang="ts">
  import Checkbox from '$lib/components/Checkbox.svelte';
  import Badge from '$lib/components/Badge.svelte';
  import Card from '$lib/components/Card.svelte';
  import FeedLine from '$lib/components/FeedLine.svelte';
  import { hostOf } from '$lib/time';
  import { plural } from '$lib/words';
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
  import Field from '$lib/components/Field.svelte';
  import Icon from '$lib/components/Icon.svelte';
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

  /* The server's rule for a collection's address (api/src/lib/slug.ts), copied so a clash shows before saving. Keep the two the same. */
  const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'untitled';

  // A finished import is over: coming back here starts a new one.
  onMount(() => { if (imp.step === 'done') startOverImport(); });
  $effect(() => { void loadCollections(); });

  /**
   * Why a group can't become a collection, said on the card itself, in one of
   * two ways: a group of dead addresses is the old reader's history, but one
   * that is all "couldn't check" usually means the connection here is bad, not
   * the feeds — and the two would otherwise look identical. Null while there
   * is still something in it that works, or might: that includes the pause
   * before slow sites are asked again, when their feeds look settled but aren't.
   */
  function blockedReason(g: ImportGroup): string | null {
    if (!settled(g) || canKeep(g)) return null;
    if (imp.checking && g.feeds.some((f) => f.state === 'unsure' && f.retry)) return null;
    const n = g.feeds.length;
    return refused(g).length === n
      ? `None of ${n === 1 ? 'this feed works' : `these ${n} feeds work`}, so thicket won’t create this collection`
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
      if (!g.keep || !base || blockedReason(g)) return;
      let name = base;
      for (let n = 1; taken.has(slugify(name)); n++) name = `${base} ${n}`;
      taken.add(slugify(name));
      out.set(i, name);
    });
    return out;
  });

  /* The groups that will become collections: exactly the ones given a final name above. */
  const kept = $derived(imp.groups.filter((_, i) => finalNames.has(i)));
  /* With a single group there is nothing to choose between, so no box to untick. */
  const choosing = $derived(imp.groups.length > 1);

  function startOver() { startOverImport(); link = ''; }

  /* A file often gives the address itself as a feed's name; the site's name says it better. */
  const label = (f: ImportFeed, site: string) => { const t = f.title?.trim(); return t && !/^https?:\/\//i.test(t) ? t : site; };

  /* What the checking bar says, read out once per stage and shown with a running count. */
  const stage = $derived(imp.retrying ? `Trying ${plural(imp.retrying, 'feed')} again that didn’t answer` : `Checking ${plural(imp.toCheck, 'feed')}`);

  /**
   * Renaming is one card at a time, the way Edit profile works: Edit name
   * swaps the heading for a labeled field with Cancel and Save under it.
   * Save (or Enter) keeps the new name; Cancel or Escape keeps the old one.
   */
  let renaming = $state<number | null>(null);
  let draft = $state('');
  let nameBox = $state<HTMLInputElement | null>(null);
  async function startRename(gi: number) {
    draft = finalNames.get(gi) ?? imp.groups[gi].name;
    renaming = gi;
    await tick();
    nameBox?.focus();
    nameBox?.select();
  }
  function finishRename(g: ImportGroup) {
    if (draft.trim()) g.name = draft.trim();
    renaming = null;
  }
  const cancelRename = () => (renaming = null);
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
    <p class="lede">Uncheck any you don’t want. Each group becomes a new collection.</p>
  {/if}
  {#if imp.preview.emptyFolders.length}
    <p class="fine">Left out, because they’re empty: {imp.preview.emptyFolders.join(', ')}.</p>
  {/if}

  <!-- Only while feeds are being checked: it says why the main button is waiting. Once done, the pills say it all. -->
  {#if imp.checking}
    <!-- The bar says how far along it is to anyone who asks; the count beside it
         ticks up once per feed, which is too much to read out, so only each
         change of stage is announced (the hidden line below). -->
    <div class="progress">
      <div class="bar" role="progressbar" aria-label="Checking feeds" aria-valuemin={0} aria-valuemax={imp.toCheck || 1} aria-valuenow={imp.toCheck ? imp.checked : 1}><span style="width: {imp.toCheck ? Math.round((imp.checked / imp.toCheck) * 100) : 100}%"></span></div>
      <span class="visually-hidden" role="status">{stage}.</span>
      <span aria-hidden="true">{imp.retrying ? stage : 'Checking feeds'}… {imp.checked} of {imp.toCheck}</span>
    </div>
  {/if}

  {#each imp.groups as g, gi (gi)}
    {@const ok = ready(g)}
    {@const bad = refused(g)}
    {@const final = finalNames.get(gi)}
    {@const renamed = !!final && final !== g.name.trim()}
    {@const why = blockedReason(g)}
    {@const on = g.keep && !why}
    <Card kind="section" as="section" class="import-section {on ? '' : 'off'}">
      <!-- A section card: the shared heading and description, with the checkbox before them
           and Edit name after. The feeds are the card's rows, laid out like the shared Feed row. -->
      <div class="ghead">
        {#if choosing}
          <!-- A group with nothing that works can't be ticked; the description says why. -->
          <!-- In a label so the tap area can reach 44px on a touchscreen without the box growing. -->
          <label class="keep tap"><Checkbox checked={on} disabled={!!why} onchange={(e) => (g.keep = e.currentTarget.checked)} aria-label="Create {g.name.trim() || 'this collection'}" /></label>
        {/if}
        <div class="gbody">
          {#if on && renaming === gi}
            <!-- Edit in place, as Edit profile does: the name becomes a labeled field with Cancel and Save under it. -->
            <form class="rename" onsubmit={(e) => { e.preventDefault(); finishRename(g); }}>
              <Field label="Name">
                {#snippet children({ id, describedBy, invalid })}
                  <Input {id} aria-describedby={describedBy} {invalid} inset bind:value={draft} bind:element={nameBox} maxlength={60} onkeydown={(e: KeyboardEvent) => { if (e.key === 'Escape') cancelRename(); }} />
                {/snippet}
              </Field>
              <div class="editrow">
                <Button onclick={cancelRename}>Cancel</Button>
                <Button type="submit" variant="primary" disabled={!draft.trim() || draft.trim() === (final ?? g.name.trim())}>Save</Button>
              </div>
            </form>
          {:else}
            <h2 class="section-title">{final ?? (g.name.trim() || 'Untitled')}</h2>
          {/if}
          {#if why}<p class="section-description">{why}</p>
          {:else if on}
            <p class="section-description">
              {#if renamed}<span class="line">A collection named “{g.name.trim()}” already exists.</span>{/if}
              <span class="line counts">{#if !settled(g) && !ok.length}Checking feeds…{:else}Importing {plural(ok.length, 'feed')}{/if}{#if bad.length}{' '}<Dot />{' '}{plural(bad.length, 'feed')} we can’t import{/if}</span>
            </p>
          {/if}
        </div>
        {#if on && renaming !== gi}<Button size="sm" onclick={() => startRename(gi)}><Icon name="pencil" size={16} />Edit name</Button>{/if}
      </div>

      {#if g.keep || why}
        {@const rows = [...ok, ...bad]}
        <div class="feeds">
        <ul class="list-rows">
          {#each g.open ? rows : rows.slice(0, SHOWN) as f (f.url)}
            {@const site = hostOf(f.siteUrl ?? f.url)}
            {@const name = label(f, site)}
            <li class="feedrow" class:refused={f.state === 'failed'}>
              <FeedLine feedId={null} {name} origin={name !== site ? site : null}>
                {#if f.reason && (f.state === 'failed' || f.state === 'unsure')}<span class="row-details reason">{f.reason}</span>{/if}
              </FeedLine>
              <!-- The status sits at the row's right end, level with the middle of the row. -->
              {#if f.state === 'pending'}<Badge>Checking…</Badge>
              {:else if f.state === 'failed'}<Badge tone="danger">Can’t import</Badge>
              {:else if f.state === 'unsure'}<Badge>Will retry</Badge>
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
      {#if imp.busy}Importing…
      {:else if imp.checking}Checking feeds…
      {:else}{kept.length === 1 ? 'Import collection' : `Import ${kept.length} collections`}{/if}
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

  .ghead { display: flex; align-items: flex-start; gap: var(--space-3); }
  /* Small beside the 21px heading, so the name leads; level with its first line (21px at 1.25 line height). */
  .keep { display: inline-flex; margin-top: 5px; }
  /* Beside the open name field the box sits level with the field's label. */
  .ghead:has(.rename) .keep { margin-top: 0; }
  .gbody { flex: 1; min-width: 0; }
  :global(.import-section.off) .section-title { color: var(--text-2); }
  /* An unchecked card is just its name: no room left under it for a description that isn't there. */
  .gbody > :global(.section-title:last-child) { margin-bottom: 0; }
  /* Spaced and lined up like the Edit profile form: the buttons at the right, under the field. */
  .rename { display: flex; flex-direction: column; gap: var(--space-3); margin-bottom: var(--space-3); }
  .editrow { display: flex; justify-content: flex-end; gap: var(--space-2); }
  /* "A collection named … already exists." gets a line of its own above the counts. */
  .line { display: block; }
  .counts { font-variant-numeric: tabular-nums; }

  /* The feeds are the card's rows, edge to edge, to the card's bottom edge.
     Each is the shared FeedLine (icon, name, site, any reason in gray) with
     its status at the right end. */
  .feeds { margin: 0 calc(-1 * var(--card-pad)) calc(-1 * var(--card-pad)); }
  .feedrow { display: flex; align-items: center; gap: var(--space-3); }
  .reason { margin-top: var(--space-1); }
  /* A feed we can't import is quieter than the ones that will come in. */
  .feedrow.refused :global(.title), .feedrow.refused :global(.origin) { color: var(--text-2); font-weight: 400; }
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
