<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { api, collectionsApi, collectionHref, profileHref } from '$lib/api';
  import { collectionStore, loadCollections, namedCollections } from '$lib/collections.svelte';
  import { session } from '$lib/session.svelte';
  import { showToast } from '$lib/toast.svelte';
  import Monogram from './Monogram.svelte';

  /**
   * The sidebar is a list of things to read, under the heading "Read": All my
   * feeds first (the superset, italic because it is not a collection), then
   * each collection alphabetically, Unsorted when it has anything, and
   * "+ New collection". Then My Bookmarks, My Notes and Explore. Nothing here
   * manages anything: a collection is managed from its own page. Mobile has
   * no room for the list, so its Collections tab opens your profile, which
   * lists them.
   */
  const path = $derived(page.url.pathname);
  const me = $derived(session.user);
  const meHref = $derived(me ? profileHref(me.handle) : '/login');
  const colHref = (slug: string) => (me ? collectionHref(me.handle, slug) : '/');
  const onCollection = (slug: string) => path === colHref(slug) || path.startsWith(colHref(slug) + '/');
  const onAnyCollection = $derived(!!me && path.startsWith(meHref + '/collections/'));
  const current = (href: string) => path === href || (href !== '/' && path.startsWith(href + '/'));
  const unsorted = $derived(collectionStore.list.find((c) => c.parentId === null));

  $effect(() => { void loadCollections(); });

  // "+ New collection" turns into an input in place; Enter makes it and opens it.
  let creating = $state(false);
  let newName = $state('');
  let busy = $state(false);
  let input = $state<HTMLInputElement | null>(null);
  function startCreate() { creating = true; newName = ''; queueMicrotask(() => input?.focus()); }
  async function create() {
    const name = newName.trim();
    if (!name || busy || !me) return;
    busy = true;
    try {
      const c = await collectionsApi.create(name);
      api.event('collection_created', { collectionId: c.id, via: 'sidebar' });
      await loadCollections(true);
      creating = false;
      await goto(collectionHref(me.handle, c.slug));
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    } finally {
      busy = false;
    }
  }

  const icons = {
    everything: 'M4 12c3-3 5-3 8 0s5 3 8 0M4 17c3-3 5-3 8 0s5 3 8 0M4 7c3-3 5-3 8 0s5 3 8 0',
    collections: 'M4 6h16M4 12h16M4 18h10',
    bookmarks: 'M6 4h12v17l-6-4-6 4z',
    notes: 'M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H10l-5 4v-4H5.5A1.5 1.5 0 0 1 4 14.5z',
    explore: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM15.5 8.5l-2 5-5 2 2-5z',
    admin: 'M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z'
  };
</script>

{#snippet icon(d: string)}
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path {d} /></svg>
{/snippet}

<nav aria-label="Primary">
  <a class="brand" href="/"><img src="/icon.svg" alt="" width="28" height="28" /><span>thicket</span></a>
  <ul>
    <!-- Mobile: the first tab is All my feeds. Desktop: "Read" is a heading over the list below. -->
    <li class="mobile-only">
      <a href="/" aria-current={path === '/' ? 'page' : undefined}>{@render icon(icons.everything)}<span class="shortl">Read</span></a>
    </li>
    <li class="mobile-only">
      <a href={meHref} aria-current={onAnyCollection || (!!me && path === meHref) ? 'page' : undefined}>{@render icon(icons.collections)}<span class="shortl">Collections</span></a>
    </li>
    <li class="collections">
      <div class="heading">{@render icon(icons.everything)}<span>Read</span></div>
      <ul class="cols" aria-label="Things to read">
        <li class="all"><a href="/" aria-current={path === '/' ? 'page' : undefined}><span class="name">All my feeds</span></a></li>
        {#each namedCollections() as c (c.id)}
          <li><a href={colHref(c.slug)} aria-current={onCollection(c.slug) ? 'page' : undefined}><span class="name">{c.name}</span><span class="n">{c.feedCount}</span></a></li>
        {/each}
        {#if unsorted && unsorted.feedCount > 0}
          <li class="unsorted"><a href={colHref(unsorted.slug)} aria-current={onCollection(unsorted.slug) ? 'page' : undefined} title="Feeds you follow that aren’t in a collection"><span class="name">Unsorted</span><span class="n">{unsorted.feedCount}</span></a></li>
        {/if}
        <li class="new">
          {#if creating}
            <form onsubmit={(e) => { e.preventDefault(); void create(); }}>
              <input bind:this={input} type="text" bind:value={newName} placeholder="Name it…" maxlength="60" disabled={busy} aria-label="New collection name"
                onkeydown={(e) => { if (e.key === 'Escape') creating = false; }} onblur={() => { if (!newName.trim()) creating = false; }} />
            </form>
          {:else}
            <button type="button" onclick={startCreate}><span class="plus" aria-hidden="true">+</span> New collection</button>
          {/if}
        </li>
      </ul>
    </li>

    <li>
      <a href="/bookmarks" aria-current={current('/bookmarks') ? 'page' : undefined}>{@render icon(icons.bookmarks)}<span class="long">My Bookmarks</span><span class="shortl">Bookmarks</span></a>
    </li>
    <li>
      <a href="/notes" aria-current={current('/notes') ? 'page' : undefined}>{@render icon(icons.notes)}<span class="long">My Notes</span><span class="shortl">Notes</span></a>
    </li>
    <li>
      <a href="/feeds" aria-current={current('/feeds') ? 'page' : undefined}>{@render icon(icons.explore)}<span class="long">Explore</span><span class="shortl">Explore</span></a>
    </li>
    {#if me?.isAdmin}
      <li class="admin">
        <a href="/admin" aria-current={current('/admin') ? 'page' : undefined}>{@render icon(icons.admin)}<span class="long">Admin</span><span class="shortl">Admin</span></a>
      </li>
    {/if}
  </ul>

  {#if me}
    <div class="account">
      <a class="who" href={meHref}>
        <Monogram name={me.displayName ?? me.handle} size={34} />
        <span class="names"><span class="dn">{me.displayName ?? me.handle}</span><span class="h">@{me.handle}</span></span>
      </a>
      <a class="gear" href="/settings" aria-label="Settings" title="Settings">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>
      </a>
    </div>
  {/if}
</nav>

<style>
  /* Mobile: a bottom bar of five tabs (Read, Collections, Bookmarks, Notes, Explore). */
  nav {
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 40;
    height: calc(var(--nav-h) + var(--safe-b)); padding-bottom: var(--safe-b);
    background: color-mix(in srgb, var(--surface) 88%, transparent);
    backdrop-filter: saturate(1.4) blur(14px); -webkit-backdrop-filter: saturate(1.4) blur(14px);
    border-top: 1px solid var(--line);
  }
  .brand, .account, .long, li.admin, li.collections { display: none; }
  ul { list-style: none; margin: 0; padding: 0; display: flex; height: var(--nav-h); }
  li { flex: 1; min-width: 0; }
  li > a {
    display: flex; width: 100%; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
    height: 100%; font-size: 10.5px; color: var(--text-3); -webkit-tap-highlight-color: transparent; white-space: nowrap;
  }
  li > a[aria-current='page'] { color: var(--accent); }

  /* Desktop: the sidebar. */
  @media (min-width: 900px) {
    nav {
      top: 0; bottom: auto; right: auto; width: 240px; height: 100vh; padding: 20px 12px 90px; overflow-y: auto;
      border-top: 0; border-right: 1px solid var(--line); background: var(--bg); backdrop-filter: none;
    }
    .brand { display: flex; align-items: center; gap: 10px; font-weight: 700; font-size: 20px; padding: 6px 10px 22px; letter-spacing: -0.01em; }
    .long { display: inline; }
    .shortl, li.mobile-only { display: none; }
    ul { flex-direction: column; height: auto; gap: 2px; }
    li { flex: none; }
    li > a { flex-direction: row; justify-content: flex-start; gap: 12px; padding: 10px 12px; border-radius: 10px; font-size: 15px; color: var(--text-2); white-space: normal; }
    li > a:hover { background: var(--surface-2); }
    li > a[aria-current='page'] { background: var(--surface-2); color: var(--text); font-weight: 600; }
    li.admin { display: block; margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--line); }

    li.collections { display: block; margin: 2px 0 8px; }
    .heading { display: flex; align-items: center; gap: 12px; padding: 10px 12px 6px; font-size: 15px; font-weight: 600; color: var(--text); }
    .cols .all > a { font-style: italic; }
    .cols { display: flex; flex-direction: column; gap: 1px; padding-left: 36px; height: auto; }
    .cols li > a { display: flex; align-items: center; gap: 8px; padding: 7px 12px; border-radius: 8px; font-size: 14px; color: var(--text-2); }
    .cols .name { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .cols .n { font-size: 12px; color: var(--text-3); }
    .cols .unsorted > a { color: var(--text-3); font-style: italic; }
    .cols .new button { display: flex; align-items: center; gap: 8px; width: 100%; padding: 7px 12px; border-radius: 8px; font-size: 13px; font-weight: 600; color: var(--accent); text-align: left; }
    .cols .new button:hover { background: var(--surface-2); }
    .plus { font-size: 16px; line-height: 1; width: 10px; }
    .cols .new input { width: 100%; font-size: 14px; padding: 6px 10px; border-radius: 8px; border: 1px solid var(--accent); background: var(--surface); color: var(--text); }

    .account { display: flex; align-items: center; gap: 4px; position: absolute; left: 12px; right: 12px; bottom: 0; padding: 12px 0 16px; border-top: 1px solid var(--line); background: var(--bg); }
    .who { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 10px; }
    .who:hover { background: var(--surface-2); }
    .names { display: flex; flex-direction: column; min-width: 0; line-height: 1.2; }
    .dn { font-weight: 600; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .h { font-size: 12px; color: var(--text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .gear { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 10px; color: var(--text-3); }
    .gear:hover { background: var(--surface-2); color: var(--text); }
  }
</style>
