<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { api, collectionsApi, collectionHref, manageCollectionHref, profileHref, profilesApi, type CollectionDetail, type CollectionFeed } from '$lib/api';
  import { openAddFeed } from '$lib/addfeed.svelte';
  import { loadCollections } from '$lib/collections.svelte';
  import { feedOrigin, hostOf, relativeTime } from '$lib/time';
  import SourceIcon from '$lib/components/SourceIcon.svelte';
  import FollowButton from '$lib/components/FollowButton.svelte';
  import { showToast } from '$lib/toast.svelte';
  import { session } from '$lib/session.svelte';

  /**
   * Managing one collection, at /@handle/collections/slug/manage. Owner only;
   * anyone else is sent to the collection itself. Top to bottom: back, what
   * you are managing, rename, visibility, description, the feeds, and at the
   * very end the two things you do rarely: delete, export.
   */
  const handle = $derived(page.params.handle ?? '');
  const slug = $derived(page.params.slug ?? '');
  let id = $state<number | null>(null);
  let col = $state<CollectionDetail | null>(null);

  const profilePrivate = $derived(session.user?.profileVisibility === 'private');
  const collectionsHidden = $derived(session.user?.showCollections === false);

  let loadedKey = $state<string | undefined>(undefined);
  async function resolve() {
    if (!session.user) return void goto(`/login?next=${encodeURIComponent(page.url.pathname)}`, { replaceState: true });
    if (session.user.handle !== handle.toLowerCase()) return void goto(collectionHref(handle, slug), { replaceState: true });
    try {
      const pub = await profilesApi.collection(handle, slug);
      id = pub.id;
      await load();
      api.event('collection_manage_view', { collectionId: id });
    } catch {
      await goto(session.user ? profileHref(session.user.handle) : '/', { replaceState: true });
    }
  }
  let memberships = $state<Record<number, number[]>>({});
  async function load() {
    if (id === null) return;
    col = await collectionsApi.get(id);
    name = col.name;
    description = col.description ?? '';
    // Which of my collections hold each feed, for the ▾ checklist. One small request per feed; lists are short.
    const pairs = await Promise.all(col.feeds.map(async (f) => [f.id, (await api.feed(f.id)).myCollectionIds] as const));
    memberships = Object.fromEntries(pairs);
  }

  /* Rename: a small link under the title turns into a field with Save / Cancel. Renaming changes the slug, so the address changes too. */
  let renaming = $state(false);
  let name = $state('');
  let savingName = $state(false);
  async function rename() {
    if (!col || savingName) return;
    const next = name.trim();
    if (!next || next === col.name) return void (renaming = false);
    savingName = true;
    try {
      const updated = await collectionsApi.update(col.id, { name: next });
      renaming = false;
      await Promise.all([load(), loadCollections(true)]);
      showToast(`Renamed to “${updated.name}”`);
      if (updated.slug !== slug) await goto(manageCollectionHref(handle, updated.slug), { replaceState: true });
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    } finally {
      savingName = false;
    }
  }

  /* Visibility: two radios. Nothing to choose when the profile hides everything anyway. */
  async function setPublic(isPublic: boolean) {
    if (!col || col.isPublic === isPublic) return;
    col.isPublic = isPublic;
    await collectionsApi.update(col.id, { isPublic });
    api.event('collection_visibility', { collectionId: col.id, isPublic });
    void loadCollections(true);
    showToast(isPublic ? 'This collection is now public' : 'This collection is now private');
  }

  /* Description: a two-line box whose Save wakes up only once something changed. */
  let description = $state('');
  let savingDesc = $state(false);
  const descDirty = $derived(!!col && description.trim().slice(0, 300) !== (col.description ?? ''));
  async function saveDescription() {
    if (!col || !descDirty || savingDesc) return;
    const next = description.trim().slice(0, 300);
    savingDesc = true;
    try {
      await collectionsApi.update(col.id, { description: next });
      api.event('collection_described', { collectionId: col.id, empty: !next });
      await Promise.all([load(), loadCollections(true)]);
      showToast(next ? 'Description saved' : 'Description removed');
    } finally {
      savingDesc = false;
    }
  }

  /** Remove from this collection only. If this was its only collection, that's an unfollow; say so and offer undo. */
  async function removeFeed(f: CollectionFeed) {
    if (!col) return;
    const snapshot = col.feeds;
    col.feeds = col.feeds.filter((x) => x.id !== f.id);
    await collectionsApi.removeFeed(col.id, f.id);
    api.event('feed_removed_from_collection', { feedId: f.id, collectionId: col.id });
    const remaining = (await api.feed(f.id)).myCollectionIds.length > 0;
    void loadCollections(true);
    showToast(remaining ? `Removed ${f.title ?? hostOf(f.url)} from ${col.name}` : `Unfollowed ${f.title ?? hostOf(f.url)}`, {
      label: 'Undo',
      run: async () => {
        if (!col) return;
        await collectionsApi.addFeed(col.id, f.id);
        col.feeds = snapshot;
        void loadCollections(true);
      }
    });
  }

  /* Delete: a modal, not the browser's box. It names the feeds that live only here and would stop being followed, each with a way out. */
  let confirmEl = $state<HTMLDialogElement | null>(null);
  let orphans = $state<Awaited<ReturnType<typeof collectionsApi.orphans>>['feeds'] | null>(null);
  let showOrphans = $state(false);
  let deleting = $state(false);
  async function askDelete() {
    if (!col) return;
    orphans = null; showOrphans = false;
    confirmEl?.showModal();
    orphans = (await collectionsApi.orphans(col.id)).feeds;
  }
  async function deleteCollection() {
    if (!col || deleting) return;
    deleting = true;
    try {
      await collectionsApi.remove(col.id);
      api.event('collection_deleted', { collectionId: col.id, orphaned: orphans?.length ?? null });
      confirmEl?.close();
      await loadCollections(true);
      showToast(`Deleted “${col.name}”`);
      await goto(profileHref(handle));
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    } finally {
      deleting = false;
    }
  }

  onMount(() => { void loadCollections(); });
  $effect(() => {
    if (!session.loaded) return;
    const key = `${handle}/${slug}`;
    if (loadedKey === key) return;
    loadedKey = key;
    col = null; renaming = false;
    void resolve();
  });
</script>

<svelte:head><title>{col ? `Managing ${col.name}` : 'Manage'} · thicket</title></svelte:head>

{#if col}
  <a class="back" href={collectionHref(handle, slug)}>
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
    Back to collection
  </a>

  <header class="top">
    <p class="pre">Managing collection:</p>
    {#if renaming}
      <form class="rename" onsubmit={(e) => { e.preventDefault(); void rename(); }}>
        <!-- svelte-ignore a11y_autofocus -->
        <input type="text" bind:value={name} autofocus maxlength="60" aria-label="Collection name" disabled={savingName} onkeydown={(e) => { if (e.key === 'Escape') { renaming = false; name = col?.name ?? ''; } }} />
        <div class="row">
          <button type="submit" class="btn primary" disabled={savingName || !name.trim()}>{savingName ? 'Saving…' : 'Save'}</button>
          <button type="button" class="btn" onclick={() => { renaming = false; name = col?.name ?? ''; }} disabled={savingName}>Cancel</button>
        </div>
      </form>
    {:else}
      <h1>{col.name}</h1>
      <button class="link" onclick={() => (renaming = true)}>Rename this collection</button>
    {/if}
  </header>

  <hr />
  <section class="opt">
    <h2>Collection visibility</h2>
      {#if profilePrivate}
        <p class="info">Your profile is set to private, so your collections aren’t displayed anywhere. <a href="/settings">Change that in Settings.</a></p>
      {:else if collectionsHidden}
        <p class="info">Your profile doesn’t show collections right now, so this setting has no effect until it does. <a href="/settings">Change that in Settings.</a></p>
      {:else}
        <div class="radios" role="radiogroup" aria-label="Collection visibility">
          <label>
            <input type="radio" name="vis" checked={col.isPublic} onchange={() => setPublic(true)} />
            <span><strong>Public</strong><small>This collection will be displayed on your profile and visible to anyone.</small></span>
          </label>
          <label>
            <input type="radio" name="vis" checked={!col.isPublic} onchange={() => setPublic(false)} />
            <span><strong>Private</strong><small>This collection will not be displayed on your profile.</small></span>
          </label>
        </div>
      {/if}
    </section>

  <section class="opt">
    <h2><label for="desc">Description</label></h2>
    <form onsubmit={(e) => { e.preventDefault(); void saveDescription(); }}>
      <textarea id="desc" rows="2" bind:value={description} maxlength="300" placeholder="What’s in here, in a line or two." disabled={savingDesc}></textarea>
      <div class="row">
        <button type="submit" class="btn primary" disabled={!descDirty || savingDesc}>{savingDesc ? 'Saving…' : 'Save'}</button>
        <span class="counter" class:near={description.length > 260}>{description.length}/300</span>
      </div>
    </form>
  </section>

  <hr />
  <section class="feeds">
    <div class="feedhead">
      <h2>Feeds ({col.feeds.length})</h2>
      <button class="btn" onclick={() => openAddFeed({ collectionIds: [col!.id], via: 'manage' })}>Add a feed</button>
    </div>
    {#if col.feeds.length === 0}
      <p class="status">Nothing in here yet. Add a feed above, or file one from any feed’s Follow menu.</p>
    {:else}
      <ul class="list">
        {#each col.feeds as f (f.id)}
          <li>
            <SourceIcon feedId={f.id} hasIcon={f.hasIcon} name={f.title ?? hostOf(f.url)} size={36} />
            <div class="meta">
              <a class="title" href={f.siteUrl ?? f.url} target="_blank" rel="noopener">{f.title ?? hostOf(f.url)}</a>
              <div class="sub2">{feedOrigin(f)}{#if f.lastItemAt} · last post {relativeTime(f.lastItemAt)}{/if}{#if f.consecutiveFailures > 0} · <span class="bad">failing</span>{/if}</div>
            </div>
            {#if memberships[f.id]}
              <FollowButton feedId={f.id} ids={memberships[f.id]} name={f.title ?? hostOf(f.url)} compact mainLabel="Remove from {col.name}" onmain={() => removeFeed(f)}
                onchange={(next) => { memberships[f.id] = next; if (!next.includes(col!.id)) void load(); void loadCollections(true); }} />
            {:else}
              <button class="chip" onclick={() => removeFeed(f)} aria-label="Remove {f.title ?? hostOf(f.url)}">Remove from {col.name}</button>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
    {#if col.children.length}
      <h3>Sub-collections</h3>
      <ul class="list children">
        {#each col.children as c (c.id)}
          <li><a href={manageCollectionHref(handle, c.slug)}><span class="name">{c.name}</span><span class="count">{c.feedCount}</span><span class="chev">›</span></a></li>
        {/each}
      </ul>
    {/if}
  </section>

  <hr />
  <div class="final">
    <button class="btn danger" onclick={askDelete}>Delete this collection</button>
    <a class="btn" href={collectionsApi.opmlUrl(col.id)} download="{col.slug}.opml" onclick={() => api.event('opml_exported', { collectionId: col?.id })} title="Save this collection as a file other readers can open">Export collection to file</a>
  </div>
{:else}
  <p class="status">Loading…</p>
{/if}

<dialog bind:this={confirmEl} onclick={(e) => { if (e.target === confirmEl) confirmEl?.close(); }}>
  {#if col}
    <div class="sheet" role="alertdialog" aria-labelledby="del-title">
      <h2 id="del-title">Deleting collection “{col.name}”</h2>
      {#if orphans === null}
        <p>Checking which feeds would be affected…</p>
      {:else}
        <p>You are about to delete this collection permanently.
          {#if orphans.length === 0}Every feed in it is also in another of your collections, so nothing will stop being followed.
          {:else}The {orphans.length} {orphans.length === 1 ? 'feed that is' : 'feeds that are'} only in this collection will no longer be followed.{/if}</p>
        {#if orphans.length > 0}
          <button class="reveal" onclick={() => (showOrphans = !showOrphans)} aria-expanded={showOrphans}>
            View the {orphans.length} {orphans.length === 1 ? 'feed' : 'feeds'} which will be removed
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style:transform={showOrphans ? 'rotate(180deg)' : 'none'}><path d="M6 9l6 6 6-6" /></svg>
          </button>
          {#if showOrphans}
            <ul class="orphans">
              {#each orphans as f (f.id)}
                <li>
                  <SourceIcon feedId={f.id} hasIcon={f.hasIcon} name={f.title ?? hostOf(f.url)} size={28} />
                  <span class="oname">{f.title ?? hostOf(f.url)}</span>
                  <a class="chip" href="/feeds/{f.id}/{f.slug}" onclick={() => confirmEl?.close()}>View feed</a>
                </li>
              {/each}
            </ul>
            <p class="hint">Add a feed to another collection first and it stays followed.</p>
          {/if}
        {/if}
      {/if}
      <div class="row">
        <button class="btn danger" onclick={deleteCollection} disabled={deleting || orphans === null}>{deleting ? 'Deleting…' : 'Delete this collection'}</button>
        <button class="btn" onclick={() => confirmEl?.close()} disabled={deleting}>Cancel</button>
      </div>
    </div>
  {/if}
</dialog>

<style>
  dialog { border: 0; padding: 0; background: transparent; max-width: 100vw; max-height: 100vh; width: 100vw; height: 100vh; margin: 0; }
  dialog::backdrop { background: rgba(0, 0, 0, 0.55); }
  .sheet { position: fixed; left: 0; right: 0; bottom: 0; background: var(--surface); color: var(--text); border-radius: 20px 20px 0 0; padding: 20px 18px calc(18px + var(--safe-b)); box-shadow: 0 -10px 40px rgba(0,0,0,0.25); max-height: 88vh; overflow: auto; }
  @media (min-width: 700px) { .sheet { left: 50%; right: auto; bottom: auto; top: 50%; transform: translate(-50%, -50%); width: 520px; border-radius: 20px; } }
  .sheet h2 { font-family: var(--font-serif); font-size: 21px; margin: 0 0 10px; overflow-wrap: anywhere; }
  .sheet p { margin: 0 0 10px; font-size: 15px; color: var(--text-2); }
  .reveal { display: inline-flex; align-items: center; gap: 6px; font-size: 14px; font-weight: 600; color: var(--accent); margin-bottom: 8px; }
  .reveal svg { transition: transform 150ms ease; }
  .orphans { list-style: none; margin: 0 0 8px; padding: 0; border: 1px solid var(--line); border-radius: 12px; max-height: 40vh; overflow-y: auto; }
  .orphans li { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-top: 1px solid var(--line); font-size: 14px; }
  .orphans li:first-child { border-top: 0; }
  .oname { flex: 1; min-width: 0; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .hint { font-size: 13px; color: var(--text-3); }
  .sheet .row { margin-top: 14px; }
  .back { display: inline-flex; align-items: center; gap: 4px; font-size: 14px; font-weight: 600; color: var(--accent); padding: 6px 0; margin-bottom: 8px; }
  .top { margin-bottom: 6px; }
  .pre { margin: 0; font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-3); }
  h1 { font-family: var(--font-serif); font-size: 28px; margin: 2px 0 0; overflow-wrap: anywhere; }
  .link { font-size: 13px; color: var(--accent); font-weight: 600; margin-top: 4px; }
  .rename { margin-top: 4px; }
  .rename input { font-family: var(--font-serif); font-size: 26px; font-weight: 600; width: 100%; padding: 4px 8px; border-radius: 8px; border: 1px solid var(--line); background: var(--surface); color: var(--text); }
  hr { border: 0; border-top: 1px solid var(--line); margin: 18px 0; }
  .opt { margin-bottom: 18px; }
  h2 { font-size: 15px; margin: 0 0 8px; }
  h3 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-3); margin: 16px 0 6px; }
  .info { margin: 0; font-size: 14px; color: var(--text-2); background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 12px 14px; }
  .info a { color: var(--accent); font-weight: 600; }
  .radios { display: flex; flex-direction: column; gap: 8px; }
  .radios label { display: flex; align-items: flex-start; gap: 12px; padding: 12px 14px; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-sm); cursor: pointer; }
  .radios label:has(input:checked) { border-color: var(--accent); }
  .radios input { margin-top: 3px; width: 18px; height: 18px; accent-color: var(--accent); flex: none; }
  .radios span { display: flex; flex-direction: column; gap: 2px; font-size: 14px; }
  .radios small { font-size: 13px; color: var(--text-3); }
  textarea { width: 100%; font: inherit; font-size: 15px; line-height: 1.4; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--line); background: var(--surface); color: var(--text); resize: vertical; }
  textarea:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
  .row { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
  .counter { margin-left: auto; font-size: 12px; color: var(--text-3); font-variant-numeric: tabular-nums; }
  .counter.near { color: var(--danger); }
  .btn { padding: 9px 14px; border-radius: 999px; border: 1px solid var(--line); background: var(--surface); font-size: 14px; font-weight: 600; color: var(--text-2); }
  .btn.primary { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
  .btn.danger { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 40%, transparent); }
  .btn:disabled { opacity: 0.5; }
  .feedhead { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
  .feedhead h2 { margin: 0; }
  .list { list-style: none; margin: 0; padding: 0; background: var(--surface); border-radius: var(--radius); box-shadow: var(--shadow); overflow: hidden; }
  .list li { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-top: 1px solid var(--line); }
  .list li:first-child { border-top: 0; }
  .children li { padding: 0; }
  .children a { display: flex; align-items: center; gap: 12px; padding: 14px 16px; width: 100%; }
  .children .name { flex: 1; font-weight: 600; }
  .meta { flex: 1; min-width: 0; }
  .title { display: block; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sub2 { font-size: 13px; color: var(--text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .bad { color: var(--danger); }
  .chip { flex: none; font-size: 13px; color: var(--text-2); padding: 7px 11px; border-radius: 999px; border: 1px solid var(--line); }
  .count, .chev { color: var(--text-3); font-size: 13px; }
  .chev { font-size: 20px; }
  .final { display: flex; gap: 8px; flex-wrap: wrap; }
  .status { text-align: center; color: var(--text-3); padding: 24px 0; margin: 0; font-size: 14px; }
</style>
