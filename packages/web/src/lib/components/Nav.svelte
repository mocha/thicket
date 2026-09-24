<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { api, collectionsApi, collectionHref, profileHref } from '$lib/api';
  import { collectionStore, loadCollections, namedCollections, topLevelCollections, childrenOf, navOpen, loadNavOpen, toggleNavOpen, collectionsOpen, loadCollectionsOpen, toggleCollectionsOpen } from '$lib/collections.svelte';
  import { session } from '$lib/session.svelte';
  import { showToast } from '$lib/toast.svelte';
  import Avatar from './Avatar.svelte';
  import AccountMenu from './AccountMenu.svelte';
  import Icon from './Icon.svelte';
  import Field from './Field.svelte';
  import Input from './Input.svelte';
  import Badge from './Badge.svelte';
  import { display } from '$lib/display.svelte';
  import { marks, badge, anyNew, countText } from '$lib/marks.svelte';

  /**
   * The sidebar, top to bottom: Everything (the whole stream, its own item
   * now), then "Collections" — a group you can fold away — holding each of your
   * collections and "+ New collection", then Bookmarks (notes live there
   * too) and Explore.
   * Nothing here manages anything: a collection is managed from its
   * own page. Mobile has no room for the list, so its Collections tab opens
   * your profile, which lists them.
   *
   * On desktop the list scrolls and the account block stays put at the bottom:
   * nav is a flex column whose middle child is the only thing that scrolls.
   */
  const path = $derived(page.url.pathname);
  const me = $derived(session.user);
  const meHref = $derived(me ? profileHref(me.handle) : '/login');
  const colHref = (slug: string) => (me ? collectionHref(me.handle, slug) : '/');
  const onCollection = (slug: string) => path === colHref(slug) || path.startsWith(colHref(slug) + '/');
  const onAnyCollection = $derived(!!me && path.startsWith(meHref + '/collections/'));
  const current = (href: string) => path === href || (href !== '/' && path.startsWith(href + '/'));
  /**
   * An open post's address is under /feeds/, but reading one is not the same as
   * browsing feeds: the reader sits over whatever list you opened it from, and
   * that list is where closing returns you. So nothing claims to be the current
   * tab while a post is open — least of all Explore, which you may never have
   * been in.
   */
  const inFeeds = $derived(path.startsWith('/feeds/') && page.state.reader === undefined);

  $effect(() => { void loadCollections(); });
  $effect(() => { loadNavOpen(); });
  $effect(() => { loadCollectionsOpen(); });
  /** A parent shows its children when it was opened on this device, or when one of them is the page you are on. */
  const isOpen = (c: { id: number }) => navOpen.ids.includes(c.id) || childrenOf(c.id).some((k) => onCollection(k.slug));

  /** "What's new" counts, when this device shows them. Everything's count is the root collection's. */
  const fresh = $derived(display.fresh);
  const rootMark = $derived(collectionStore.rootId ? marks.byId[collectionStore.rootId] : undefined);
  const anyColNew = $derived(fresh && anyNew(namedCollections().map((c) => c.id)));

  // The account menu (Your profile / Settings / Log out), opened from the
  // avatar block on desktop and the "You" tab on the phone. It anchors itself
  // to whichever of the two opened it.
  let menuOpen = $state(false);
  let menuAnchor = $state<HTMLElement | null>(null);
  function openMenu(e: MouseEvent) {
    menuAnchor = e.currentTarget as HTMLElement;
    menuOpen = true;
  }

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

  // Filter the sidebar's collections: a slim field sits at the top of the list
  // and narrows it to names containing what you type, ignoring case. Shown only
  // once there are enough collections to bother, so short lists stay clean.
  let filter = $state('');
  const showFilter = $derived(namedCollections().length > 6);
  const filtered = $derived.by(() => {
    const q = filter.trim().toLowerCase();
    return q ? namedCollections().filter((c) => c.name.toLowerCase().includes(q)) : [];
  });
  // Leaving for a page clears the filter, so you never return to a sidebar
  // mysteriously narrowed to your last search.
  $effect(() => { void path; filter = ''; });

  const icons = {
    everything: 'M4 12c3-3 5-3 8 0s5 3 8 0M4 17c3-3 5-3 8 0s5 3 8 0M4 7c3-3 5-3 8 0s5 3 8 0',
    collections: 'M4 6h16M4 12h16M4 18h10',
    bookmarks: 'M6 4h12v17l-6-4-6 4z',
    explore: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM15.5 8.5l-2 5-5 2 2-5z',
    admin: 'M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z'
  };
</script>

{#snippet row(c: { id: number; name: string; slug: string })}
  {@const b = fresh ? badge(marks.byId[c.id]) : { kind: 'none' as const }}
  <a href={colHref(c.slug)} aria-current={onCollection(c.slug) ? 'page' : undefined} class:new={b.kind !== 'none'}><span class="name">{c.name}</span>{#if b.kind === 'count'}<Badge tone="accent">{b.text}</Badge>{:else if b.kind === 'dot'}<Badge variant="dot" class="inrow" title={b.title} />{/if}</a>
{/snippet}

{#snippet icon(d: string)}
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path {d} /></svg>
{/snippet}

<!-- Paged layout keeps the bottom bar at every width: a sidebar is a scrolling thing. -->
<nav aria-label="Primary" class:paged={display.layout === 'paged'}>
  <a class="brand" href="/"><img src="/icon.svg" alt="" width="28" height="28" /><span>thicket</span></a>
  <ul>
    <!-- Mobile-only tabs. On desktop, Everything and My collections live in the li.collections block below. -->
    <li class="mobile-only">
      <a href="/" aria-current={path === '/' ? 'page' : undefined}><span class="ic">{@render icon(icons.everything)}{#if fresh && rootMark?.count}<Badge variant="dot" class="pin" aria-label="New posts" />{/if}</span><span class="shortl">Everything</span></a>
    </li>
    <li class="mobile-only">
      <a href={meHref} aria-current={onAnyCollection ? 'page' : undefined}><span class="ic">{@render icon(icons.collections)}{#if anyColNew}<Badge variant="dot" class="pin" aria-label="New posts" />{/if}</span><span class="shortl">Collections</span></a>
    </li>
    <li class="collections">
      <!-- Everything: the whole stream, its own item now — the job the old italic "All collections" row did. -->
      <a class="readall" href="/" aria-current={path === '/' ? 'page' : undefined}>{@render icon(icons.everything)}<span>Everything</span>{#if fresh && rootMark?.count}<Badge tone="accent" class="tail">{countText(rootMark)}</Badge>{/if}</a>
      <!-- My collections: a group you can fold away. Your collections sit under it. -->
      <button type="button" class="heading" aria-expanded={collectionsOpen.open} aria-controls="my-collections" onclick={toggleCollectionsOpen}>
        {@render icon(icons.collections)}<span>Collections</span>
        <span class="groupcaret"><Icon name="caret" size={14} stroke={2.5} dir={collectionsOpen.open ? 'down' : 'right'} /></span>
      </button>
      {#if collectionsOpen.open}
      <ul class="cols" id="my-collections" aria-label="Your collections">
        {#if showFilter}
          <li class="filterrow">
            <Field label="Filter collections" hideLabel>
              {#snippet children({ id })}
                <Input
                  {id}
                  variant="search"
                  size="sm"
                  bind:value={filter}
                  placeholder="Filter collections…"
                  maxlength="60"
                  autocomplete="off"
                  onkeydown={(e: KeyboardEvent) => { if (e.key === 'Escape') filter = ''; }}
                />
              {/snippet}
            </Field>
          </li>
        {/if}
        {#if filter.trim()}
          <!-- A search wants a flat list of matches, not the folded tree. -->
          {#each filtered as c (c.id)}
            <li>{@render row(c)}</li>
          {:else}
            <li class="nomatch">No collections match “{filter.trim()}”.</li>
          {/each}
        {:else}
          {#each topLevelCollections() as c (c.id)}
            {@const kids = childrenOf(c.id)}
            <li class:parent={kids.length > 0}>
              {@render row(c)}
              {#if kids.length}
                <button type="button" class="caret" aria-expanded={isOpen(c)} aria-label="{isOpen(c) ? 'Hide' : 'Show'} the collections inside {c.name}" onclick={() => toggleNavOpen(c.id)}>
                  <Icon name="caret" size={14} stroke={2.5} dir={isOpen(c) ? 'down' : 'right'} />
                </button>
              {/if}
            </li>
            {#if kids.length && isOpen(c)}
              {#each kids as k (k.id)}
                <li class="child">{@render row(k)}</li>
              {/each}
            {/if}
          {/each}
        {/if}
        <li class="new">
          {#if creating}
            <form onsubmit={(e) => { e.preventDefault(); void create(); }}>
              <Field label="New collection name" hideLabel>
                {#snippet children({ id })}
                  <Input
                    {id}
                    bind:element={input}
                    variant="create"
                    size="sm"
                    bind:value={newName}
                    placeholder="Name it…"
                    maxlength="60"
                    disabled={busy}
                    onkeydown={(e: KeyboardEvent) => { if (e.key === 'Escape') creating = false; }}
                    onblur={() => { if (!newName.trim()) creating = false; }}
                  />
                {/snippet}
              </Field>
            </form>
          {:else}
            <button type="button" onclick={startCreate}><span class="plus" aria-hidden="true">+</span> New collection</button>
          {/if}
        </li>
      </ul>
      {/if}
    </li>

    <li>
      <a href="/bookmarks" aria-current={current('/bookmarks') ? 'page' : undefined}>{@render icon(icons.bookmarks)}<span class="long">Bookmarks</span><span class="shortl">Bookmarks</span></a>
    </li>
    <li>
      <a href="/explore" aria-current={current('/explore') || inFeeds ? 'page' : undefined}>{@render icon(icons.explore)}<span class="long">Explore</span><span class="shortl">Explore</span></a>
    </li>
    <!-- Mobile: you. Opens the account menu — your profile, settings, and log out. -->
    {#if me}
      <li class="mobile-only you">
        <button type="button" class="tab" onclick={openMenu} aria-haspopup="menu" aria-expanded={menuOpen}><span class="mono"><Avatar handle={me.handle} name={me.displayName ?? me.handle} size={24} v={me.avatarUpdatedAt} /></span><span class="shortl">You</span></button>
      </li>
    {/if}
    {#if me?.isAdmin}
      <li class="admin">
        <a href="/admin" aria-current={current('/admin') ? 'page' : undefined}>{@render icon(icons.admin)}<span class="long">Admin</span><span class="shortl">Admin</span></a>
      </li>
    {/if}
  </ul>

  {#if me}
    <div class="account">
      <button type="button" class="who" onclick={openMenu} aria-haspopup="menu" aria-expanded={menuOpen}>
        <Avatar handle={me.handle} name={me.displayName ?? me.handle} size={34} v={me.avatarUpdatedAt} />
        <span class="names"><span class="dn">{me.displayName ?? me.handle}</span><span class="h">@{me.handle}</span></span>
        <span class="chev"><Icon name="caret" dir="down" size={16} stroke={2.5} /></span>
      </button>
    </div>
  {/if}

  {#if menuOpen}
    <AccountMenu anchor={menuAnchor} onclose={() => (menuOpen = false)} />
  {/if}
</nav>

<style>
  /* Mobile: a bottom bar of four tabs (Read, Collections, Bookmarks, Explore), then You. */
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
  li > a, li.you > .tab {
    display: flex; width: 100%; flex-direction: column; align-items: center; justify-content: center; /* 2px is an optical gap between a tab's icon and its label. */ gap: 2px;
    height: 100%; font-size: calc(var(--text-xs) * var(--size-app)); color: var(--text-3); -webkit-tap-highlight-color: transparent; white-space: nowrap;
  }
  li > a[aria-current='page'] { color: var(--accent); }
  .mono { display: grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; }
  /* "What's new": a dot on a tab, a count in the sidebar. */
  .ic { position: relative; display: grid; place-items: center; }
  /* Pinned to the corner of a tab's icon; the dot itself is a Badge. The offsets
     are optical, set against the icon's own shape rather than the spacing scale. */
  .ic :global(.pin) { position: absolute; top: -1px; right: -5px; }
  /* Sitting inline before a collection's name, where it needs no ring to lift it. */
  nav :global(.inrow) { box-shadow: none; margin-right: var(--space-1); }
  li.you > .tab[aria-expanded='true'] .mono { outline: 2px solid var(--accent); outline-offset: 1px; }

  /* Desktop: the sidebar. */
  @media (min-width: 900px) {
    nav:not(.paged) {
      top: 0; bottom: auto; right: auto; width: var(--nav-w); height: 100vh; height: 100dvh; padding: var(--space-4) var(--space-3) 0; overflow: hidden;
      display: flex; flex-direction: column;
      border-top: 0; border-right: 1px solid var(--line); background: var(--bg); backdrop-filter: none;
    }
    nav:not(.paged) .brand { display: flex; flex: none; align-items: center; gap: var(--space-3); font-weight: 700; font-size: calc(var(--text-xl) * var(--size-app)); padding: var(--space-1) var(--space-3) var(--space-5); letter-spacing: -0.01em; }
    nav:not(.paged) .long { display: inline; }
    nav:not(.paged) .shortl, nav:not(.paged) li.mobile-only { display: none; }
    /* The only scrolling part, so the account block below it never drifts up into the list. */
    nav:not(.paged) ul { flex-direction: column; height: auto; /* 2px is an optical hairline between rows, not spacing. */ gap: 2px; flex: 1 1 auto; min-height: 0; overflow-y: auto; }
    nav:not(.paged) li { flex: none; }
    nav:not(.paged) li > a { flex-direction: row; justify-content: flex-start; gap: var(--space-3); padding: var(--space-2) var(--space-3); border-radius: var(--radius-sm); font-size: calc(var(--text-base) * var(--size-app)); color: var(--text-2); white-space: normal; }
    nav:not(.paged) li > a:hover { background: var(--surface-2); }
    nav:not(.paged) li > a[aria-current='page'] { background: var(--surface-2); color: var(--text); font-weight: 600; }
    nav:not(.paged) li.admin { display: block; margin-top: var(--space-3); padding-top: var(--space-3); border-top: 1px solid var(--line); }

    nav:not(.paged) li.collections { display: block; }
    /* Breathing room under the expanded list only; collapsed, the row spaces like its neighbors. */
    nav:not(.paged) li.collections .cols { margin-bottom: var(--space-2); }
    /* "My collections": a header you can click to fold the list away. Looks like a row, reads like a heading. */
    nav:not(.paged) .heading { display: flex; align-items: center; gap: var(--space-3); width: 100%; padding: var(--space-2) var(--space-3); border-radius: var(--radius-sm); font-size: calc(var(--text-base) * var(--size-app)); font-weight: 600; color: var(--text); text-align: left; }
    nav:not(.paged) .heading:hover { background: var(--surface-2); }
    nav:not(.paged) .groupcaret { flex: none; margin-left: auto; display: flex; color: var(--text-3); }
    /* The filter box draws itself; the row only holds it off the list below. */
    nav:not(.paged) .cols .filterrow { margin-bottom: var(--space-1); }
    nav:not(.paged) .cols .nomatch { padding: var(--space-2) var(--space-3); font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-3); }
    /* The Everything row is a normal-height row: undo the full-height stretch the bottom-bar tabs use. */
    nav:not(.paged) .readall { height: auto; }
    /* It carries the whole stream's "what's new" count, pushed to the row's end. */
    nav:not(.paged) .readall :global(.tail) { margin-left: auto; }
    nav:not(.paged) .cols { display: flex; flex-direction: column; /* 1px is a hairline between child rows. */ gap: 1px; /* Lines the child rows up under a parent's label: the row's own padding plus its icon column. */ padding-left: calc(var(--space-5) + var(--space-3)); height: auto; }
    nav:not(.paged) .cols li > a { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-2) var(--space-3); border-radius: var(--radius-sm); font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); }
    /* A parent: the name is the link, the caret beside it opens the group. Children sit indented under it. */
    nav:not(.paged) .cols li.parent { display: flex; align-items: center; /* 2px is an optical gap: the caret tucks against the name. */ gap: 2px; }
    nav:not(.paged) .cols li.parent > a { flex: 1; min-width: 0; }
    nav:not(.paged) .cols .caret { flex: none; display: grid; place-items: center; width: 26px; height: 26px; border-radius: var(--radius-sm); color: var(--text-3); }
    nav:not(.paged) .cols .caret:hover { background: var(--surface-2); color: var(--text); }
    nav:not(.paged) .cols li.child > a { padding-left: var(--space-5); }
    nav:not(.paged) .cols .name { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    /* Something new: the name goes bold, the count or dot sits beside it. Bold reads in grayscale where a color would not. */
    nav:not(.paged) .cols a.new .name { font-weight: 500; color: var(--text); }

    nav:not(.paged) .cols .new button { display: flex; align-items: center; gap: var(--space-2); width: 100%; padding: var(--space-2) var(--space-3); border-radius: var(--radius-sm); font-size: calc(var(--text-sm) * var(--size-app)); font-weight: 600; color: var(--accent); text-align: left; }
    nav:not(.paged) .cols .new button:hover { background: var(--surface-2); }
    nav:not(.paged) .plus { font-size: calc(var(--text-base) * var(--size-app)); line-height: 1; width: 10px; }

    nav:not(.paged) .account { display: flex; flex: none; align-items: center; gap: var(--space-1); padding: var(--space-3) 0 var(--space-4); border-top: 1px solid var(--line); background: var(--bg); }
    nav:not(.paged) .who { flex: 1; min-width: 0; display: flex; align-items: center; gap: var(--space-3); padding: var(--space-2) var(--space-3); border-radius: var(--radius-sm); text-align: left; }
    nav:not(.paged) .who:hover { background: var(--surface-2); }
    nav:not(.paged) .names { display: flex; flex-direction: column; min-width: 0; line-height: 1.2; }
    nav:not(.paged) .dn { font-weight: 600; font-size: calc(var(--text-sm) * var(--size-app)); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    nav:not(.paged) .h { font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    nav:not(.paged) .who .chev { flex: none; margin-left: auto; display: flex; color: var(--text-3); }
  }
</style>
