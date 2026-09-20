<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { api, collectionsApi, collectionHref, manageCollectionHref, profileHref, profilesApi, type CollectionDetail, type CollectionFeed, type ShareLevel } from '$lib/api';
  import { collectionStore, loadCollections } from '$lib/collections.svelte';
  import { feedOrigin, hostOf, relativeTime } from '$lib/time';
  import { feedListName } from '$lib/feedname';
  import SourceIcon from '$lib/components/SourceIcon.svelte';
  import AddFeedButton from '$lib/components/AddFeedButton.svelte';
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
  const collectionsHidden = $derived(session.user?.collectionsVisibility === 'private');
  const collectionsFriendsOnly = $derived(session.user?.collectionsVisibility === 'friends');

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

  /**
   * Visibility: the account's own three audiences, one collection at a time.
   * A collection only ever narrows what the account shares — picking Public
   * here inside a friends-only account still means those friends, which the
   * note above the radios says out loud. Nothing to choose at all when the
   * profile hides everything anyway.
   */
  const VISIBILITIES: { value: ShareLevel; label: string; help: string; toast: string }[] = [
    { value: 'public', label: 'Public', help: 'This collection is visible to anyone on the web.', toast: 'This collection is now public' },
    { value: 'friends', label: 'People I follow', help: 'This collection is shared with people I follow.', toast: 'This collection is now shared with the people you follow' },
    { value: 'private', label: 'Private', help: 'Only I can see this collection.', toast: 'This collection is now private' },
  ];
  async function setVisibility(next: ShareLevel) {
    if (!col || col.visibility === next) return;
    col.visibility = next;
    await collectionsApi.update(col.id, { visibility: next });
    api.event('collection_visibility', { collectionId: col.id, visibility: next });
    void loadCollections(true);
    showToast(VISIBILITIES.find((v) => v.value === next)?.toast ?? 'Saved');
  }

  /* Description: a two-line box that saves itself a beat after you stop typing, and the moment you click away. */
  let description = $state('');
  let savingDesc = $state(false);
  let descSaved = $state(false);
  let descTimer: ReturnType<typeof setTimeout> | undefined;
  const descDirty = $derived(!!col && description.trim().slice(0, 300) !== (col.description ?? ''));
  async function saveDescription() {
    if (!col || !descDirty || savingDesc) return;
    const next = description.trim().slice(0, 300);
    savingDesc = true;
    descSaved = false;
    try {
      await collectionsApi.update(col.id, { description: next });
      api.event('collection_described', { collectionId: col.id, empty: !next });
      await Promise.all([load(), loadCollections(true)]);
      descSaved = true;
    } finally {
      savingDesc = false;
    }
  }
  /* Wait until typing pauses, then save. Clicking away saves right then. Editing again hides the "Saved" note. */
  function descChanged() {
    descSaved = false;
    clearTimeout(descTimer);
    descTimer = setTimeout(() => void saveDescription(), 800);
  }
  function descBlur() {
    clearTimeout(descTimer);
    void saveDescription();
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

  /*
   * Merge: this collection goes INTO another. That one keeps its name and description and gains these feeds;
   * sub-collections move with them; this one is deleted. A modal, like delete, that says what will happen first.
   */
  let mergeEl = $state<HTMLDialogElement | null>(null);
  let mergeInto = $state<number | null>(null);
  let merging = $state(false);
  /** Every collection of mine this one could go into: not itself, not the root, not one of its own sub-collections. */
  const mergeTargets = $derived.by(() => {
    if (!col) return [];
    const inside = new Set<number>([col.id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const c of collectionStore.list) if (c.parentId !== null && inside.has(c.parentId) && !inside.has(c.id)) { inside.add(c.id); grew = true; }
    }
    return collectionStore.list.filter((c) => c.parentId !== null && !inside.has(c.id)).sort((a, b) => a.name.localeCompare(b.name));
  });
  const mergeTarget = $derived(mergeTargets.find((c) => c.id === mergeInto) ?? null);
  function askMerge() {
    mergeInto = null;
    void loadCollections(true);
    mergeEl?.showModal();
  }
  async function mergeCollection() {
    if (!col || !mergeTarget || merging) return;
    merging = true;
    try {
      const r = await collectionsApi.merge(col.id, mergeTarget.id);
      api.event('collection_merged', { collectionId: col.id, intoId: r.into.id, added: r.added, movedChildren: r.movedChildren });
      mergeEl?.close();
      await loadCollections(true);
      showToast(`Merged “${col.name}” into “${r.into.name}”`);
      await goto(manageCollectionHref(handle, r.into.slug));
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    } finally {
      merging = false;
    }
  }

  /* The rare-actions menu that hangs off the ⋮ button: export, merge, delete. Closes on click-away or Escape. */
  let menuOpen = $state(false);
  let menuAnchor = $state<HTMLElement | null>(null);
  let menuPanel = $state<HTMLElement | null>(null);
  $effect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => { if (!menuPanel?.contains(e.target as Node) && !menuAnchor?.contains(e.target as Node)) menuOpen = false; };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') menuOpen = false; };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  });

  onMount(() => { void loadCollections(); });
  $effect(() => {
    if (!session.loaded) return;
    const key = `${handle}/${slug}`;
    if (loadedKey === key) return;
    loadedKey = key;
    col = null; renaming = false;
    // Leaving this collection for another: drop any lingering "Saved" flag.
    clearTimeout(descTimer); descSaved = false;
    void resolve();
  });
  // Leaving the page entirely clears it too.
  onDestroy(() => { clearTimeout(descTimer); descSaved = false; });
</script>

<svelte:head><title>{col ? `Managing ${col.name}` : 'Manage'} · thicket</title></svelte:head>

{#if col}
  <a class="back" href={collectionHref(handle, slug)}>
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
    Back to {col.name} collection
  </a>

  <header class="top">
    <div class="titlebar">
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
        <div class="titlerow">
          <h1>{col.name}</h1>
          <button class="edit" onclick={() => (renaming = true)} aria-label="Rename this collection" title="Rename this collection">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z" /></svg>
          </button>
        </div>
      {/if}
      <div class="menu" bind:this={menuAnchor}>
        <button class="kebab" aria-haspopup="menu" aria-expanded={menuOpen} aria-label="More collection actions" onclick={() => (menuOpen = !menuOpen)}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" /></svg>
        </button>
        {#if menuOpen}
          <div class="menupanel" role="menu" bind:this={menuPanel}>
            <a class="mi" role="menuitem" href={collectionsApi.opmlUrl(col.id)} download="{col.slug}.opml" onclick={() => { api.event('opml_exported', { collectionId: col?.id }); menuOpen = false; }} title="Save this collection as a file other readers can open">Export collection to file</a>
            <button class="mi" role="menuitem" onclick={() => { menuOpen = false; askMerge(); }}>Merge into another collection</button>
            <button class="mi danger" role="menuitem" onclick={() => { menuOpen = false; askDelete(); }}>Delete this collection</button>
          </div>
        {/if}
      </div>
    </div>
  </header>

  <hr />
  <section class="opt">
    <h2><label for="desc">Description</label></h2>
    <form onsubmit={(e) => { e.preventDefault(); void saveDescription(); }}>
      <div class="descbox">
        <textarea id="desc" rows="5" bind:value={description} maxlength="300" placeholder="What’s in here, in a line or two." oninput={descChanged} onblur={descBlur}></textarea>
        {#if descSaved}<span class="saved" aria-live="polite">Saved</span>{/if}
      </div>
      <div class="row">
        <span class="counter" class:near={description.length > 260}>{description.length}/300</span>
      </div>
    </form>
  </section>

  <section class="opt">
    <h2>Collection visibility</h2>
    <p class="subtle">Who should be able to see this collection?</p>
    {#if profilePrivate}
      <p class="info">Your profile is set to private, so your collections aren’t displayed anywhere. <a href="/settings">Change that in Settings.</a></p>
    {:else if collectionsHidden}
      <p class="info">Your profile doesn’t show collections to anyone right now, so this setting has no effect until it does. <a href="/settings">Change that in Settings.</a></p>
    {:else}
      {#if collectionsFriendsOnly}<p class="info">Your collections are shown only to the people you follow. Public here means public to them. <a href="/settings">Change that in Settings.</a></p>{/if}
      <div class="radios vis" role="radiogroup" aria-label="Collection visibility">
        {#each VISIBILITIES as v (v.value)}
          <label>
            <input type="radio" name="vis" value={v.value} checked={col.visibility === v.value} onchange={() => setVisibility(v.value)} />
            <span><strong>{v.label}</strong><small>{v.help}</small></span>
          </label>
        {/each}
      </div>
    {/if}
  </section>

  <hr />
  <section class="feeds">
    <div class="feedhead">
      <h2>Feeds ({col.feeds.length})</h2>
      <AddFeedButton collectionIds={[col!.id]} via="manage" />
    </div>
    {#if col.feeds.length === 0}
      <p class="status">Nothing in here yet. Add a feed above, or file one from any feed’s Follow menu.</p>
    {:else}
      <ul class="list">
        {#each col.feeds as f (f.id)}
          <li>
            <SourceIcon feedId={f.id} hasIcon={f.hasIcon} name={f.title ?? hostOf(f.url)} size={36} />
            <div class="meta">
              <a class="title" href="/feeds/{f.id}">{feedListName(f)}</a>
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

  <dialog bind:this={mergeEl} onclick={(e) => { if (e.target === mergeEl) mergeEl?.close(); }}>
    <div class="sheet" role="alertdialog" aria-labelledby="merge-title">
      <h2 id="merge-title">Merging collection “{col.name}”</h2>
      {#if mergeTargets.length === 0}
        <p>You don’t have another collection to merge this one into.</p>
      {:else}
        <label class="pick">
          <span>Merge into</span>
          <select bind:value={mergeInto} disabled={merging}>
            <option value={null} disabled>Choose a collection…</option>
            {#each mergeTargets as c (c.id)}<option value={c.id}>{c.name} ({c.feedCount} {c.feedCount === 1 ? 'feed' : 'feeds'})</option>{/each}
          </select>
        </label>
        {#if mergeTarget}
          <p>“{mergeTarget.name}” keeps its name, description and visibility, and gains every feed from “{col.name}” it doesn’t already have.{#if col.children.length} {col.children.length === 1 ? 'The sub-collection moves' : `The ${col.children.length} sub-collections move`} into it too.{/if}</p>
          <p>Then “{col.name}” is deleted, and links to it stop working. Nothing stops being followed.</p>
        {/if}
      {/if}
      <div class="row">
        <button class="btn primary" onclick={mergeCollection} disabled={merging || !mergeTarget}>{merging ? 'Merging…' : 'Merge'}</button>
        <button class="btn" onclick={() => mergeEl?.close()} disabled={merging}>Cancel</button>
      </div>
    </div>
  </dialog>
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
  .sheet h2 { font-family: var(--font-headings); font-size: calc(21px * var(--size-headings)); margin: 0 0 10px; overflow-wrap: anywhere; }
  .sheet p { margin: 0 0 10px; font-size: calc(15px * var(--size-app)); color: var(--text-2); }
  .reveal { display: inline-flex; align-items: center; gap: 6px; font-size: calc(14px * var(--size-app)); font-weight: 600; color: var(--accent); margin-bottom: 8px; }
  .reveal svg { transition: transform 150ms ease; }
  .orphans { list-style: none; margin: 0 0 8px; padding: 0; border: 1px solid var(--line); border-radius: 12px; max-height: 40vh; overflow-y: auto; }
  .orphans li { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-top: 1px solid var(--line); font-size: calc(14px * var(--size-app)); }
  .orphans li:first-child { border-top: 0; }
  .oname { flex: 1; min-width: 0; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .hint { font-size: calc(13px * var(--size-app)); color: var(--text-3); }
  .pick { display: flex; flex-direction: column; gap: 6px; margin: 4px 0 12px; font-size: calc(13px * var(--size-app)); font-weight: 600; color: var(--text-2); }
  .pick select { font: inherit; font-size: calc(15px * var(--size-app)); font-weight: 400; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--line); background: var(--surface); color: var(--text); }
  .pick select:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
  .sheet .row { margin-top: 14px; }
  .back { display: inline-flex; align-items: center; gap: 4px; font-size: calc(14px * var(--size-app)); font-weight: 600; color: var(--accent); padding: 6px 0; margin-bottom: 8px; }
  .top { margin-bottom: 6px; }
  h1 { font-family: var(--font-headings); font-size: calc(28px * var(--size-headings)); margin: 2px 0 0; overflow-wrap: anywhere; }
  .titlebar { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
  .titlerow { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; }
  .rename { flex: 1; }
  .edit { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; border-radius: 999px; border: 1px solid var(--line); background: var(--surface); color: var(--text-2); }
  .edit:hover { background: var(--surface-2); color: var(--text); }
  .rename { margin-top: 4px; }
  .rename input { font-family: var(--font-headings); font-size: calc(26px * var(--size-headings)); font-weight: 600; width: 100%; padding: 4px 8px; border-radius: 8px; border: 1px solid var(--line); background: var(--surface); color: var(--text); }
  hr { border: 0; border-top: 1px solid var(--line); margin: 18px 0; }
  .opt { margin-bottom: 18px; }
  h2 { font-size: calc(20px * var(--size-app)); margin: 0 0 12px; line-height: 1.25; }
  h3 { font-size: calc(13px * var(--size-app)); text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-3); margin: 16px 0 6px; }
  .info { margin: 0; font-size: calc(14px * var(--size-app)); color: var(--text-2); background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 12px 14px; }
  .info a { color: var(--accent); font-weight: 600; }
  .subtle { margin: -4px 0 10px; font-size: calc(13px * var(--size-app)); color: var(--text-3); }
  .radios { display: flex; flex-direction: column; gap: 8px; }
  /* Side by side once there is room for three; stacked on a phone, where they would be three slivers. */
  @media (min-width: 620px) { .vis { display: grid; grid-template-columns: repeat(3, 1fr); align-items: stretch; } }
  .descbox { position: relative; }
  /* A fixed box tall enough for the full 300 characters; a reserved strip at the bottom keeps typed text clear of the "Saved" note. */
  .descbox textarea { padding-bottom: 30px; resize: none; }
  .saved { position: absolute; right: 12px; bottom: 9px; font-size: calc(12px * var(--size-app)); font-weight: 600; color: var(--accent); background: var(--surface); padding: 1px 6px; border-radius: 6px; pointer-events: none; }
  .radios label { display: flex; align-items: flex-start; gap: 12px; padding: 12px 14px; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-sm); cursor: pointer; }
  .vis label { gap: 8px; }
  .radios label:has(input:checked) { border-color: var(--accent); }
  .radios input { margin-top: 3px; width: 18px; height: 18px; accent-color: var(--accent); flex: none; }
  .radios span { display: flex; flex-direction: column; gap: 2px; font-size: calc(14px * var(--size-app)); }
  .radios small { font-size: calc(13px * var(--size-app)); color: var(--text-3); }
  textarea { width: 100%; font: inherit; font-size: calc(15px * var(--size-app)); line-height: 1.4; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--line); background: var(--surface); color: var(--text); resize: vertical; }
  textarea:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
  .row { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
  .counter { margin-left: auto; font-size: calc(12px * var(--size-app)); color: var(--text-3); font-variant-numeric: tabular-nums; }
  .counter.near { color: var(--danger); }
  .btn { padding: 9px 14px; border-radius: 999px; border: 1px solid var(--line); background: var(--surface); font-size: calc(14px * var(--size-app)); font-weight: 600; color: var(--text-2); }
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
  .sub2 { font-size: calc(13px * var(--size-app)); color: var(--text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .bad { color: var(--danger); }
  .chip { flex: none; font-size: calc(13px * var(--size-app)); color: var(--text-2); padding: 7px 11px; border-radius: 999px; border: 1px solid var(--line); }
  .count, .chev { color: var(--text-3); font-size: calc(13px * var(--size-app)); }
  .chev { font-size: calc(20px * var(--size-app)); }
  .menu { position: relative; flex: none; }
  .kebab { display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; border-radius: 999px; border: 1px solid var(--line); background: var(--surface); color: var(--text-2); }
  .kebab:hover { background: var(--surface-2); color: var(--text); }
  /* Hangs below the button, right-aligned, from its spot in the header. */
  .menupanel { position: absolute; top: calc(100% + 6px); right: 0; z-index: 60; min-width: 244px; background: var(--surface); border-radius: 14px; padding: 6px; box-shadow: 0 12px 40px rgba(0,0,0,0.3), 0 0 0 1px var(--line); display: flex; flex-direction: column; }
  .mi { display: block; width: 100%; text-align: left; padding: 10px 12px; border-radius: 10px; font-size: calc(14px * var(--size-app)); font-weight: 600; color: var(--text); }
  .mi:hover { background: var(--surface-2); }
  .mi.danger { color: var(--danger); }
  .status { text-align: center; color: var(--text-3); padding: 24px 0; margin: 0; font-size: calc(14px * var(--size-app)); }
</style>
