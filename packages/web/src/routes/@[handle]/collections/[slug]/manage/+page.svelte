<script lang="ts">
  import PageHeader from '$lib/components/PageHeader.svelte';
  import { onMount, onDestroy } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { api, collectionsApi, collectionHref, manageCollectionHref, profileHref, profilesApi, type CollectionDetail, type ShareLevel } from '$lib/api';
  import { collectionStore, loadCollections } from '$lib/collections.svelte';
  import { hostOf } from '$lib/time';
  import SourceIcon from '$lib/components/SourceIcon.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import Button from '$lib/components/Button.svelte';
  import Field from '$lib/components/Field.svelte';
  import Input from '$lib/components/Input.svelte';
  import Textarea from '$lib/components/Textarea.svelte';
  import BackLink from '$lib/components/BackLink.svelte';
  import Select from '$lib/components/Select.svelte';
  import Sheet from '$lib/components/Sheet.svelte';
  import { showToast } from '$lib/toast.svelte';
  import { session } from '$lib/session.svelte';

  /**
   * Managing one collection, at /@handle/collections/slug/manage. Owner only;
   * anyone else is sent to the collection itself. Laid out like managing a
   * feed. Top to bottom: a breadcrumb back to the collection as the header,
   * with Delete beside it (where Unfollow sits for a feed), then its name,
   * description, visibility, and merging it into another collection. Settings
   * only: the list of its feeds, adding to it, and exporting it live on the
   * collection's own page.
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
  async function load() {
    if (id === null) return;
    col = await collectionsApi.get(id);
    name = col.name;
    description = col.description ?? '';
  }

  /* Name: a field with Save inside it, which wakes up once the name changed, like a feed's Display name. Renaming changes the slug, so the address changes too. */
  let name = $state('');
  let savingName = $state(false);
  const nameDirty = $derived(!!col && !!name.trim() && name.trim() !== col.name);
  async function rename() {
    if (!col || savingName) return;
    const next = name.trim();
    if (!next || next === col.name) return;
    savingName = true;
    try {
      const updated = await collectionsApi.update(col.id, { name: next });
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
   * sub-collections move with them; this one is deleted. Done in the page: pick the other collection, read what will
   * happen (it appears once one is picked), then Merge.
   */
  /* The dropdown hands back the id as text, so that's how it's kept; empty
     means nothing has been chosen yet. */
  let mergeInto = $state('');
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
  const mergeTarget = $derived(mergeTargets.find((c) => String(c.id) === mergeInto) ?? null);
  async function mergeCollection() {
    if (!col || !mergeTarget || merging) return;
    merging = true;
    try {
      const r = await collectionsApi.merge(col.id, mergeTarget.id);
      api.event('collection_merged', { collectionId: col.id, intoId: r.into.id, added: r.added, movedChildren: r.movedChildren });
      await loadCollections(true);
      showToast(`Merged “${col.name}” into “${r.into.name}”`);
      await goto(manageCollectionHref(handle, r.into.slug));
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    } finally {
      merging = false;
    }
  }

  onMount(() => { void loadCollections(); });
  $effect(() => {
    if (!session.loaded) return;
    const key = `${handle}/${slug}`;
    if (loadedKey === key) return;
    loadedKey = key;
    col = null; mergeInto = '';
    // Leaving this collection for another: drop any lingering "Saved" flag.
    clearTimeout(descTimer); descSaved = false;
    void resolve();
  });
  // Leaving the page entirely clears it too.
  onDestroy(() => { clearTimeout(descTimer); descSaved = false; });
</script>

<svelte:head><title>{col ? `Managing ${col.name}` : 'Manage'} · thicket</title></svelte:head>

{#if col}
  {@const here = col}
  <PageHeader name="Manage collection">
    {#snippet above()}<BackLink href={collectionHref(handle, slug)} label={here.name} />{/snippet}
    {#snippet description()}Its name, description, and who can see it.{/snippet}
    {#snippet actions()}<Button variant="danger" size="sm" onclick={askDelete}>Delete collection</Button>{/snippet}
  </PageHeader>
  <form class="opt" onsubmit={(e) => { e.preventDefault(); void rename(); }}>
    <Field label="Name">
      {#snippet children({ id, describedBy, invalid })}
        <Input {id} aria-describedby={describedBy} {invalid} bind:value={name} maxlength={60} disabled={savingName}>
          {#snippet trailing()}
            <Button type="submit" variant="primary" disabled={!nameDirty || savingName}>{savingName ? 'Saving…' : 'Save'}</Button>
          {/snippet}
        </Input>
      {/snippet}
    </Field>
  </form>

  <section class="opt">
    <form onsubmit={(e) => { e.preventDefault(); void saveDescription(); }}>
      <Field label="Description">
        {#snippet children({ id, describedBy, invalid })}
          <Textarea
            {id}
            aria-describedby={describedBy}
            {invalid}
            bind:value={description}
            rows={5}
            resize="none"
            maxlength={300}
            counter
            placeholder="What’s in here, in a line or two."
            oninput={descChanged}
            onblur={descBlur}
          >
            {#snippet status()}{#if descSaved}Saved{/if}{/snippet}
          </Textarea>
        {/snippet}
      </Field>
    </form>
  </section>

  <section class="opt">
    <h2>Collection visibility</h2>
    <p class="subtle">Who should be able to see this collection?</p>
    {#if profilePrivate}
      <p class="info">Your profile is private, so your collections aren’t shown anywhere. Make it public <a href={profileHref(handle)}>on your profile</a> and you’ll be able to choose who sees this one.</p>
    {:else if collectionsHidden}
      <p class="info">None of your collections are shown to anyone right now, so picking an audience here won’t do anything yet. Change that <a href={profileHref(handle)}>on your profile</a>.</p>
    {:else}
      {#if collectionsFriendsOnly}<p class="info">You share your collections only with the people you follow. Public here means public to them. Change that <a href={profileHref(handle)}>on your profile</a>.</p>{/if}
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

  <section class="opt">
    <h2>Merge into another collection</h2>
    {#if mergeTargets.length === 0}
      <p class="subtle">You don’t have another collection to merge this one into.</p>
    {:else}
      <p class="subtle">That collection gains these feeds, and this one is deleted.</p>
      <div class="mergerow">
        <Select
          class="pick"
          label="Merge into"
          hideLabel
          bind:value={mergeInto}
          disabled={merging}
          options={[
            { value: '', label: 'Choose a collection…', disabled: true },
            ...mergeTargets.map((c) => ({
              value: String(c.id),
              label: `${c.name} (${c.feedCount} ${c.feedCount === 1 ? 'feed' : 'feeds'})`
            }))
          ]}
        />
        <Button variant="primary" onclick={mergeCollection} disabled={merging || !mergeTarget}>{merging ? 'Merging…' : 'Merge'}</Button>
      </div>
      {#if mergeTarget}
        <p class="after">“{mergeTarget.name}” keeps its name, description, and visibility, and gains every feed from “{col.name}” it doesn’t already have.{#if col.children.length} {col.children.length === 1 ? 'The sub-collection moves' : `The ${col.children.length} sub-collections move`} into it too.{/if} Then “{col.name}” is deleted, and links to it stop working. Nothing stops being followed.</p>
      {/if}
    {/if}
  </section>


{:else}
  <p class="status">Loading…</p>
{/if}

{#if col}
  <Sheet
    title="Delete “{col.name}”?"
    lede={orphans === null
      ? 'Checking its feeds…'
      : `${orphans.length === 0 ? 'Its feeds are all in your other collections, so you’ll keep following them.' : `You’ll stop following the ${orphans.length === 1 ? '1 feed that’s' : `${orphans.length} feeds that are`} only in this collection.`} This can’t be undone.`}
    alert
    locked={deleting}
    bind:dialog={confirmEl}
  >
    {#if orphans?.length}
      <button class="reveal tap" onclick={() => (showOrphans = !showOrphans)} aria-expanded={showOrphans}>
        {showOrphans ? 'Hide' : 'Show'} {orphans.length === 1 ? 'the feed' : `the ${orphans.length} feeds`}
        <Icon name="caret" size={14} stroke={2.4} dir={showOrphans ? 'up' : 'down'} />
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
        <p class="hint">To keep following one, add it to another collection first.</p>
      {/if}
    {/if}
    {#snippet footer()}
      <Button variant="danger" solid size="lg" onclick={deleteCollection} disabled={deleting || orphans === null}>{deleting ? 'Deleting…' : 'Delete collection'}</Button>
    {/snippet}
  </Sheet>
{/if}

<style>
  .reveal { align-self: flex-start; display: inline-flex; align-items: center; gap: var(--space-2); font-size: calc(var(--text-sm) * var(--size-app)); font-weight: 600; color: var(--accent); }
  .orphans { list-style: none; margin: 0; padding: 0; border: 1px solid var(--line); border-radius: var(--radius-sm); max-height: 40vh; overflow-y: auto; }
  .orphans li { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-2) var(--space-3); border-top: 1px solid var(--line); font-size: calc(var(--text-sm) * var(--size-app)); }
  .orphans li:first-child { border-top: 0; }
  .oname { flex: 1; min-width: 0; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .hint { margin: 0; font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); }
  /* The breadcrumb is the header and takes the room; Delete keeps its size at the right. */
  /* Between one setting and the next: more than the gap inside a setting, so each reads as its own group. */
  .opt { margin-bottom: var(--space-6); }
  /* Section headings match a field's label, as on a feed's settings page, so "Name" and "Collection visibility" read as the same kind of thing. */
  h2 { font-size: calc(var(--text-base) * var(--size-app)); font-weight: 600; margin: 0 0 var(--space-3); line-height: 1.25; }
  .info { margin: 0; font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-sm); padding: var(--space-3) var(--space-4); }
  .info a { color: var(--accent); font-weight: 600; }
  .subtle { margin: calc(-1 * var(--space-2)) 0 var(--space-3); font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); }
  .radios { display: flex; flex-direction: column; gap: var(--space-2); }
  /* Side by side once there is room for three; stacked on a phone, where they would be three slivers. */
  @media (min-width: 620px) { .vis { display: grid; grid-template-columns: repeat(3, 1fr); align-items: stretch; } }
  .radios label { display: flex; align-items: flex-start; gap: var(--space-3); padding: var(--space-3) var(--space-4); background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-sm); cursor: pointer; }
  .vis label { gap: var(--space-2); }
  .radios label:has(input:checked) { border-color: var(--accent); }
  .radios input { margin-top: var(--space-1); width: 18px; height: 18px; accent-color: var(--accent); flex: none; }
  /* 2px between a choice and its explanation is optical, not a spacing step. */
  .radios span { display: flex; flex-direction: column; gap: 2px; font-size: calc(var(--text-sm) * var(--size-app)); }
  .radios small { font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); }
  /* The picker takes the room; Merge keeps its size beside it. */
  .mergerow { display: flex; align-items: center; gap: var(--space-2); }
  .mergerow :global(.pick) { flex: 1; min-width: 0; }
  .after { margin: var(--space-3) 0 0; font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); }
  .chip { flex: none; font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); padding: var(--space-2) var(--space-3); border-radius: var(--radius-pill); border: 1px solid var(--line); }
  .status { text-align: center; color: var(--text-2); padding: var(--space-5) 0; margin: 0; font-size: calc(var(--text-sm) * var(--size-app)); }
</style>
