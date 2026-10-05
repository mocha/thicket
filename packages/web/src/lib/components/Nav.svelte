<script lang="ts">
  import { page } from '$app/state';
  import Wordmark from './Wordmark.svelte';
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
  import { notifs, notifText } from '$lib/notifications.svelte';
  import { navWidth, loadNavWidth, setNavWidth, NAV_W_MIN, NAV_W_MAX, NAV_W_DEFAULT } from '$lib/navwidth.svelte';

  /**
   * The sidebar, top to bottom: Everything (the whole stream, its own item
   * now), then "Collections" — a group you can fold away — holding each of your
   * collections and "+ New collection", then Bookmarks (notes live there
   * too), Notifications (with a count of what is new) and Explore.
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
  /** The phone's Collections tab opens your profile, which lists them, so it is current there too. */
  const onAnyCollection = $derived(!!me && (path === '/collections' || path.startsWith(meHref + '/collections/')));
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

  // The sidebar's right edge is a handle: drag it, or focus it and use the
  // arrow keys, to set how wide the sidebar is. Double-click puts it back.
  // The sidebar starts at the window's left edge, so the pointer's x is the width.
  $effect(() => { loadNavWidth(); });
  let dragging = $state(false);
  function dragStart(e: PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragging = true;
  }
  // Mid-drag the pointer strays off the thin handle; keep the resize cursor, and keep the page from selecting text.
  $effect(() => { document.documentElement.classList.toggle('nav-resizing', dragging); });
  function dragMove(e: PointerEvent) { if (dragging) setNavWidth(e.clientX, false); }
  function dragEnd() { if (!dragging) return; dragging = false; setNavWidth(navWidth.px); }
  function resizeKey(e: KeyboardEvent) {
    const next = { ArrowLeft: navWidth.px - 16, ArrowRight: navWidth.px + 16, Home: NAV_W_MIN, End: NAV_W_MAX }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    setNavWidth(next);
  }

  const icons = {
    everything: 'M4 12c3-3 5-3 8 0s5 3 8 0M4 17c3-3 5-3 8 0s5 3 8 0M4 7c3-3 5-3 8 0s5 3 8 0',
    collections: 'M4 6h16M4 12h16M4 18h10',
    bookmarks: 'M6 4h12v17l-6-4-6 4z',
    notifications: 'M6 9a6 6 0 0 1 12 0c0 6 2.5 8 2.5 8h-17S6 15 6 9M10 20.5a2.2 2.2 0 0 0 4 0',
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
  <a class="brand" href="/everything"><img src="/icon.svg" alt="" width="28" height="28" /><Wordmark height={23} /></a>
  <ul>
    <!-- Mobile-only tabs. On desktop, Everything and My collections live in the li.collections block below. -->
    <li class="mobile-only">
      <a href="/everything" aria-current={path === '/everything' ? 'page' : undefined}><span class="ic">{@render icon(icons.everything)}{#if fresh && rootMark?.count}<Badge variant="dot" class="pin" aria-label="New posts" />{/if}</span><span class="shortl">Everything</span></a>
    </li>
    <li class="mobile-only">
      <a href="/collections" aria-current={onAnyCollection ? 'page' : undefined}><span class="ic">{@render icon(icons.collections)}{#if anyColNew}<Badge variant="dot" class="pin" aria-label="New posts" />{/if}</span><span class="shortl">Collections</span></a>
    </li>
    <li class="collections">
      <!-- Everything: the whole stream, its own item now — the job the old italic "All collections" row did. -->
      <a class="readall" href="/everything" aria-current={path === '/everything' ? 'page' : undefined}>{@render icon(icons.everything)}<span>Everything</span>{#if fresh && rootMark?.count}<Badge tone="accent" class="tail">{countText(rootMark)}</Badge>{/if}</a>
      <!-- My collections: a group you can fold away. Your collections sit under it.
           The word opens the Collections screen (the same one the bottom bar's
           tab opens on a phone); the caret beside it folds the list. -->
      <div class="heading" class:current={path === '/collections'}>
        <a class="headlink" href="/collections" aria-current={path === '/collections' ? 'page' : undefined}>{@render icon(icons.collections)}<span>Collections</span></a>
        <button type="button" class="groupcaret" aria-expanded={collectionsOpen.open} aria-controls="my-collections" aria-label={collectionsOpen.open ? 'Hide your collections' : 'Show your collections'} onclick={toggleCollectionsOpen}>
          <Icon name="caret" size={14} stroke={2.5} dir={collectionsOpen.open ? 'down' : 'right'} />
        </button>
      </div>
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
    <!-- Sidebar only: the bottom bar is full, so on a phone Notifications is in the You menu, and the You tab carries its dot. -->
    <li class="notifs">
      <a href="/notifications" aria-current={current('/notifications') ? 'page' : undefined}>{@render icon(icons.notifications)}<span class="long">Notifications</span>{#if notifText()}<Badge tone="accent" class="tail" aria-label="{notifText()} new">{notifText()}</Badge>{/if}</a>
    </li>
    <li>
      <a href="/explore" aria-current={current('/explore') || inFeeds ? 'page' : undefined}>{@render icon(icons.explore)}<span class="long">Explore</span><span class="shortl">Explore</span></a>
    </li>
    <!-- Mobile: you. Opens the account menu — your profile, settings, and log out. -->
    {#if me}
      <li class="mobile-only you">
        <button type="button" class="tab" onclick={openMenu} aria-haspopup="menu" aria-expanded={menuOpen}><span class="mono ic"><Avatar handle={me.handle} name={me.displayName ?? me.handle} size={24} v={me.avatarUpdatedAt} />{#if notifs.count}<Badge variant="dot" class="pin" aria-label="New notifications" />{/if}</span><span class="shortl">You</span></button>
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

  <!-- Desktop only; the bottom bar has no edge to drag. A focusable separator
       with a value is an interactive control in ARIA; the checker doesn't know that. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
  <div
    class="resize"
    class:dragging
    role="separator"
    aria-orientation="vertical"
    aria-label="Sidebar width"
    aria-valuemin={NAV_W_MIN}
    aria-valuemax={NAV_W_MAX}
    aria-valuenow={navWidth.px}
    tabindex="0"
    onpointerdown={dragStart}
    onpointermove={dragMove}
    onpointerup={dragEnd}
    onpointercancel={dragEnd}
    onkeydown={resizeKey}
    ondblclick={() => setNavWidth(NAV_W_DEFAULT)}
  ></div>
</nav>

<style>
  /* Mobile: a bottom bar of four tabs (Read, Collections, Bookmarks, Explore), then You. */
  nav {
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 40;
    height: calc(var(--nav-h) + var(--safe-b)); padding-bottom: var(--safe-b);
    /* On its side, a phone's notch and rounded corners eat into the ends of the bar. */
    padding-left: env(safe-area-inset-left, 0px); padding-right: env(safe-area-inset-right, 0px);
    background: color-mix(in srgb, var(--surface) 88%, transparent);
    backdrop-filter: saturate(1.4) blur(14px); -webkit-backdrop-filter: saturate(1.4) blur(14px);
    border-top: 1px solid var(--line);
  }
  .brand, .account, .long, li.admin, li.collections, li.notifs, .resize { display: none; }
  ul { list-style: none; margin: 0; padding: 0; display: flex; height: var(--nav-h); }
  /* Each tab is as wide as its label plus an even share of the spare room, so
     "Collections" gets more than "You" and none of them touch. Never narrower
     than a finger. */
  li { flex: 1 1 auto; min-width: 44px; }
  /* How wide the five labels are in total, in ems of their own text, per app
     font (measured). The labels follow the App size setting up to the point
     where they'd collide on this screen, then stop growing: the window, less
     an 8px gap per tab, shared out over that many ems. OpenDyslexic runs so
     wide that on a small phone this takes it below its usual size. */
  nav { --bar-em: 21; }
  :global(:root[data-font-app='serif']) nav { --bar-em: 22; }
  :global(:root[data-font-app='dyslexic']) nav { --bar-em: 29.5; }
  li > a, li.you > .tab {
    display: flex; width: 100%; flex-direction: column; align-items: center; justify-content: center; /* 2px is an optical gap between a tab's icon and its label. */ gap: 2px;
    height: 100%; font-size: min(calc(var(--text-xs) * var(--bar-scale)), calc((100vw - 40px - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px)) / var(--bar-em))); color: var(--text-2); -webkit-tap-highlight-color: transparent; white-space: nowrap;
  }
  /* Bold as well as green, so the current tab still stands out for someone who can't tell the green from the gray. */
  li > a[aria-current='page'] { color: var(--accent); font-weight: 700; }
  /* A label too long for its tab trails off rather than running into its neighbor. */
  .shortl { max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
  /* Drawn just inside the tab, in the accent color like the kit's other rings:
     the browser's own ring sits outside it, where the screen edge cuts it off. */
  li > a:focus-visible, li.you > .tab:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; border-radius: var(--radius-sm); }
  .mono { display: grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; }
  /* "What's new": a dot on a tab, a count in the sidebar. */
  .ic { position: relative; display: grid; place-items: center; }
  /* Pinned to the corner of a tab's icon; the dot itself is a Badge. The offsets
     are optical, set against the icon's own shape rather than the spacing scale. */
  .ic :global(.pin) { position: absolute; top: -1px; right: -5px; }
  /* Sitting inline before a collection's name, where it needs no ring to lift it. */
  nav :global(.inrow) { box-shadow: none; margin-right: var(--space-1); }
  li.you > .tab[aria-expanded='true'] .mono { outline: 2px solid var(--accent); outline-offset: 1px; }

  /* Desktop: the sidebar. A phone turned on its side can be wider than 900px
     (the largest are 932 and up) but it is still a phone: short, and worked by
     touch. It keeps the bottom bar. So the sidebar needs the width and either
     some height or a mouse. The same condition is repeated wherever something
     depends on the sidebar being there (search for "min-height: 501px"). */
  @media (min-width: 900px) and (min-height: 501px), (min-width: 900px) and (pointer: fine) {
    nav:not(.paged) {
      top: 0; bottom: auto; right: auto; width: var(--nav-w); height: 100vh; height: 100dvh; padding: var(--space-4) var(--space-3) 0; overflow: hidden;
      display: flex; flex-direction: column;
      border-top: 0; border-right: 1px solid var(--line); background: var(--bg); backdrop-filter: none; -webkit-backdrop-filter: none;
    }
    nav:not(.paged) .brand { display: flex; flex: none; align-items: center; gap: var(--space-2); color: var(--text); padding: var(--space-1) var(--space-3) var(--space-5); }
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
    nav:not(.paged) li.notifs { display: block; }
    /* Its count sits at the row's end, like Everything's. */
    nav:not(.paged) li.notifs :global(.tail) { margin-left: auto; }
    /* Breathing room under the expanded list only; collapsed, the row spaces like its neighbors. */
    nav:not(.paged) li.collections .cols { margin-bottom: var(--space-2); }
    /* "My collections": a header you can click to fold the list away. Looks like a row, reads like a heading. */
    /* One row, two things to press: the word is a link, the caret folds the list. */
    nav:not(.paged) .heading { display: flex; align-items: center; width: 100%; border-radius: var(--radius-sm); font-size: calc(var(--text-base) * var(--size-app)); font-weight: 600; color: var(--text); }
    nav:not(.paged) .heading:hover, nav:not(.paged) .heading.current { background: var(--surface-2); }
    nav:not(.paged) .headlink { flex: 1; min-width: 0; display: flex; align-items: center; gap: var(--space-3); padding: var(--space-2) 0 var(--space-2) var(--space-3); border-radius: var(--radius-sm); color: inherit; }
    nav:not(.paged) .groupcaret { flex: none; display: grid; place-items: center; width: 32px; align-self: stretch; margin-right: var(--space-1); border-radius: var(--radius-sm); color: var(--text-3); }
    nav:not(.paged) .groupcaret:hover { color: var(--text); }
    /* The filter box draws itself; the row only holds it off the list below. */
    nav:not(.paged) .cols .filterrow { margin-bottom: var(--space-1); }
    nav:not(.paged) .cols .nomatch { padding: var(--space-2) var(--space-3); font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); }
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
    nav:not(.paged) .h { font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    nav:not(.paged) .who .chev { flex: none; margin-left: auto; display: flex; color: var(--text-3); }

    /* The drag handle: an 8px strip along the sidebar's edge. The edge's own
       hairline turns accent while you hover, drag, or tab to it. */
    nav:not(.paged) .resize { display: block; position: absolute; top: 0; bottom: 0; right: 0; width: var(--space-2); cursor: col-resize; touch-action: none; }
    nav:not(.paged) .resize::after { content: ''; position: absolute; top: 0; bottom: 0; right: 0; width: 2px; background: transparent; transition: background-color 0.12s; }
    nav:not(.paged) .resize:hover::after, nav:not(.paged) .resize.dragging::after { background: var(--accent); }
    nav:not(.paged) .resize:focus-visible { outline: none; }
    nav:not(.paged) .resize:focus-visible::after { width: 3px; background: var(--accent); }
    :global(html.nav-resizing), :global(html.nav-resizing *) { cursor: col-resize !important; user-select: none; }
  }
</style>
