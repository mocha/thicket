<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { api, exploreApi, feedHref, collectionHref, profileHref, profilesApi, type Feed, type ExploreCollection, type ExploreUser } from '$lib/api';
  import { feedOrigin, hostOf, relativeTime } from '$lib/time';
  import { session } from '$lib/session.svelte';
  import { openAddFeed } from '$lib/addfeed.svelte';
  import SourceIcon from '$lib/components/SourceIcon.svelte';
  import FollowButton from '$lib/components/FollowButton.svelte';
  import Monogram from '$lib/components/Monogram.svelte';
  import { showToast } from '$lib/toast.svelte';

  /**
   * Explore: three ways to find something new, one page. Feeds (the instance
   * index), collections other people made public, and people to follow. Each
   * view has the same skeleton: header with an action, search, filters, list.
   * Everything lives in the URL (?view=, ?q=, filters) so a view is linkable.
   */
  type View = 'feeds' | 'collections' | 'users';
  const view = $derived(((page.url.searchParams.get('view') as View | null) ?? 'feeds') as View);
  const q = $derived(page.url.searchParams.get('q') ?? '');
  /**
    * One filter, off by default: absent shows the whole index, 'following'
    * narrows to what the people you follow read. Explore's job is to show
    * what is here, so the unfiltered view is the one you land on.
    */
  const narrowToNetwork = $derived(page.url.searchParams.get('by') === 'following');
  const since = $derived(page.url.searchParams.get('since'));
  const sort = $derived(page.url.searchParams.get('sort') ?? 'recent');
  /** Checking the box is only useful once you follow someone. */
  let followsAnyone = $state<boolean | null>(null);
  const feedsNetwork = $derived(narrowToNetwork ? '1' : null);
  const colsNetwork = $derived(narrowToNetwork);

  function setParams(patch: Record<string, string | null>) {
    const p = new URLSearchParams(page.url.searchParams);
    for (const [k, v] of Object.entries(patch)) v ? p.set(k, v) : p.delete(k);
    void goto(`/feeds${p.size ? `?${p}` : ''}`, { replaceState: true, keepFocus: true });
  }
  function switchView(v: View) {
    // Per-view filters reset; the search box and the follow filter carry over,
    // since both tabs mean the same thing by it.
    setParams({ view: v === 'feeds' ? null : v, since: null, sort: null });
    api.event('explore_view', { view: v });
  }

  let draft = $state('');
  let timer: ReturnType<typeof setTimeout>;
  function onSearch(v: string) {
    draft = v;
    clearTimeout(timer);
    timer = setTimeout(() => setParams({ q: v.trim() || null }), 250);
  }

  /* ---- feeds ---- */
  let feeds = $state<Feed[]>([]);
  let feedsTotal = $state(0);
  let feedsAll = $state(0);
  let feedsNext = $state<number | null>(null);
  const sorts = [
    { id: 'recent', label: 'Recently posted' },
    { id: 'followers', label: 'Most followed' },
    { id: 'posts', label: 'Most active' },
    { id: 'title', label: 'A–Z' },
    { id: 'added', label: 'Newest here' }
  ];
  async function loadFeeds(reset = false) {
    if (loading || (!reset && feedsNext === null)) return;
    loading = true; error = null;
    try {
      const res = await api.feeds({ q, network: feedsNetwork, since, sort, limit: 50, offset: reset ? 0 : feedsNext ?? 0 });
      feeds = reset ? res.feeds : [...feeds, ...res.feeds];
      feedsTotal = res.total; feedsAll = res.indexTotal; feedsNext = res.nextOffset;
    } catch (e) { error = e instanceof Error ? e.message : String(e); } finally { loading = false; }
  }

  /* ---- collections ---- */
  let cols = $state<ExploreCollection[]>([]);
  let colsTotal = $state(0);
  let colsAll = $state(0);
  let colsNext = $state<number | null>(null);
  async function loadCols(reset = false) {
    if (loading || (!reset && colsNext === null)) return;
    loading = true; error = null;
    try {
      const res = await exploreApi.collections({ q, network: colsNetwork, limit: 30, offset: reset ? 0 : colsNext ?? 0 });
      cols = reset ? res.collections : [...cols, ...res.collections];
      colsTotal = res.total; colsAll = res.indexTotal; colsNext = res.nextOffset;
    } catch (e) { error = e instanceof Error ? e.message : String(e); } finally { loading = false; }
  }

  /* ---- users ---- */
  let users = $state<ExploreUser[]>([]);
  let usersTotal = $state(0);
  let usersAll = $state(0);
  let usersNext = $state<number | null>(null);
  async function loadUsers(reset = false) {
    if (loading || (!reset && usersNext === null)) return;
    loading = true; error = null;
    try {
      const res = await exploreApi.users({ q, limit: 30, offset: reset ? 0 : usersNext ?? 0 });
      users = reset ? res.users : [...users, ...res.users];
      usersTotal = res.total; usersAll = res.indexTotal; usersNext = res.nextOffset;
    } catch (e) { error = e instanceof Error ? e.message : String(e); } finally { loading = false; }
  }
  let followBusy = $state<string | null>(null);
  async function toggleFollow(u: ExploreUser) {
    if (followBusy) return;
    followBusy = u.handle;
    try {
      const r = u.isFollowing ? await profilesApi.unfollow(u.handle) : await profilesApi.follow(u.handle);
      u.isFollowing = r.isFollowing;
      followsAnyone = r.isFollowing ? true : followsAnyone;
      api.event(r.isFollowing ? 'user_followed' : 'user_unfollowed', { handle: u.handle, via: 'explore' });
      showToast(r.isFollowing ? `Following ${u.displayName ?? '@' + u.handle}` : `Unfollowed ${u.displayName ?? '@' + u.handle}`);
    } catch (e) { showToast(e instanceof Error ? e.message : String(e)); } finally { followBusy = null; }
  }

  /* ---- shared ---- */
  let loading = $state(false);
  let error = $state<string | null>(null);
  let sentinel = $state<HTMLElement | null>(null);
  let loadedKey = $state<string | undefined>(undefined);

  onMount(() => {
    api.event('feeds_view'); draft = q;
    if (session.user) profilesApi.get(session.user.handle).then((p) => { followsAnyone = !p.private && p.people.follows > 0; }).catch(() => (followsAnyone = false));
    else followsAnyone = false;
  });

  $effect(() => {
    if (followsAnyone === null) return; // wait until we know the default
    const key = `${view}|${q}|${feedsNetwork}|${since}|${sort}|${colsNetwork}`;
    if (loadedKey === key) return;
    loadedKey = key;
    if (view === 'feeds') { feeds = []; feedsNext = null; void loadFeeds(true); }
    else if (view === 'collections') { cols = []; colsNext = null; void loadCols(true); }
    else { users = []; usersNext = null; void loadUsers(true); }
  });
  $effect(() => {
    if (!sentinel) return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { if (view === 'feeds') void loadFeeds(); else if (view === 'collections') void loadCols(); else void loadUsers(); } }, { rootMargin: '800px 0px' });
    io.observe(sentinel);
    return () => io.disconnect();
  });

  const total = $derived(view === 'feeds' ? feedsTotal : view === 'collections' ? colsTotal : usersTotal);
  const all = $derived(view === 'feeds' ? feedsAll : view === 'collections' ? colsAll : usersAll);
  /**
   * A search or filter makes this a count of results, not of everything there
   * is. Saying so is the difference between "the index holds 154 feeds" and
   * "154 of them match" — the first reading is what a bare number invites.
   */
  const count = $derived(total === all || !all ? `${total.toLocaleString()}` : `${total.toLocaleString()} of ${all.toLocaleString()}`);
  const empty = $derived(!loading && (view === 'feeds' ? feeds.length : view === 'collections' ? cols.length : users.length) === 0);
</script>

<svelte:head><title>Explore · thicket</title></svelte:head>

<header class="top">
  <h1>Explore</h1>
  <p class="sub">Look for new feeds to read, find collections other people have put together, and people to follow.</p>
</header>

<div class="views" role="tablist" aria-label="What to browse">
  <button role="tab" aria-selected={view === 'feeds'} onclick={() => switchView('feeds')}>Browse feeds</button>
  <button role="tab" aria-selected={view === 'collections'} onclick={() => switchView('collections')}>Browse collections</button>
  <button role="tab" aria-selected={view === 'users'} onclick={() => switchView('users')}>Browse users</button>
</div>

<section class="pane">
  <div class="head">
    <div class="titles">
      {#if view === 'feeds'}
        <h2>Find new feeds <span class="count">{count}</span></h2>
        <p>Every feed this instance knows about — the ones people here read, and a few thousand more it was seeded with. Search it, filter it, and take what looks good.</p>
      {:else if view === 'collections'}
        <h2>Find new collections <span class="count">{count}</span></h2>
        <p>Browse collections of feeds curated by other users and copy them to your profile.</p>
      {:else}
        <h2>Find users <span class="count">{count}</span></h2>
        <p>Search for people with public profiles, browse their collections, and follow them to see their notes and what they read.</p>
      {/if}
    </div>
    {#if view === 'feeds'}
      <button class="add" onclick={() => openAddFeed({ via: 'explore' })}><span aria-hidden="true">+</span> Add a new feed</button>
    {/if}
  </div>

  <input class="search" type="search" placeholder={view === 'feeds' ? 'Search feeds by name or description' : view === 'collections' ? 'Search collections by name or description' : 'Search by handle, name or bio'} value={draft} oninput={(e) => onSearch(e.currentTarget.value)} aria-label="Search" />

  {#if view === 'feeds'}
    <div class="filters">
      <label class="filter check" title={followsAnyone === false ? 'Follow someone first' : ''}>
        <input type="checkbox" checked={narrowToNetwork} disabled={followsAnyone === false} onchange={(e) => setParams({ by: e.currentTarget.checked ? 'following' : null })} />
        <span class="label">Only what people I follow read</span>
      </label>
      <label class="filter">
        <span class="label">Added in the last</span>
        <select value={since ?? ''} onchange={(e) => setParams({ since: e.currentTarget.value || null })}>
          <option value="">any time</option>
          <option value="24h">24 hours</option>
          <option value="week">week</option>
          <option value="month">month</option>
          <option value="year">year</option>
        </select>
      </label>
      <label class="filter">
        <span class="label">Sort</span>
        <select value={sort} onchange={(e) => setParams({ sort: e.currentTarget.value === 'recent' ? null : e.currentTarget.value })}>
          {#each sorts as s}<option value={s.id}>{s.label}</option>{/each}
        </select>
      </label>
    </div>
  {:else if view === 'collections'}
    <div class="filters">
      <label class="filter check" title={followsAnyone === false ? 'Follow someone first' : ''}>
        <input type="checkbox" checked={narrowToNetwork} disabled={followsAnyone === false} onchange={(e) => setParams({ by: e.currentTarget.checked ? 'following' : null })} />
        <span class="label">Only from people I follow</span>
      </label>
    </div>
  {/if}

  {#if error}
    <p class="status error">Couldn’t load: {error}</p>
  {:else if empty}
    <div class="empty">
      {#if view === 'feeds'}
        {#if q}<p>No feeds match “{q}”.</p>
        {:else if feedsNetwork}<p>The people you follow haven’t followed anything you don’t already. <button class="link" onclick={() => setParams({ by: null })}>Show the whole index</button>.</p>
        {:else if since}<p>Nothing was added in that time.</p>
        {:else}<p>Nobody has added a feed yet. Be the first: press <strong>Add a new feed</strong> and paste a site’s address.</p>{/if}
      {:else if view === 'collections'}
        {#if q}<p>No collections match “{q}”.</p>
        {:else if colsNetwork}<p>The people you follow haven’t shared any collections yet. <button class="link" onclick={() => setParams({ by: null })}>Show everyone’s</button>.</p>
        {:else}<p>No one has shared a public collection yet. Yours could be first: open a collection, Manage, and set it to Public.</p>{/if}
      {:else}
        {#if q}<p>No one matches “{q}”.</p>{:else}<p>No other public profiles here yet.</p>{/if}
      {/if}
    </div>
  {:else if view === 'feeds'}
    <ul class="list">
      {#each feeds as f (f.id)}
        <li>
          <a class="row" href={feedHref(f)}>
            <SourceIcon feedId={f.id} hasIcon={f.hasIcon} name={f.title ?? hostOf(f.url)} size={40} />
            <div class="meta">
              <span class="title">{f.title ?? hostOf(f.url)}</span>
              <span class="sub2">
                {feedOrigin(f)}
                {#if f.lastItemAt} · {relativeTime(f.lastItemAt)}{/if}
                {#if f.postsLast30d} · {f.postsLast30d}/mo{/if}
                {#if feedsNetwork && f.networkFollowers} · <span class="net-n">{f.networkFollowers} {f.networkFollowers === 1 ? 'person' : 'people'} you follow</span>{/if}
                {#if f.consecutiveFailures >= 3} · <span class="bad">failing</span>{/if}
              </span>
            </div>
          </a>
          <FollowButton feedId={f.id} bind:ids={f.myCollectionIds} name={f.title ?? hostOf(f.url)} compact onchange={() => void api.feed(f.id).then((u) => Object.assign(f, u))} />
        </li>
      {/each}
    </ul>
  {:else if view === 'collections'}
    <ul class="list">
      {#each cols as c (c.id)}
        <li>
          <a class="row" href={collectionHref(c.handle, c.slug)}>
            <span class="stack" aria-hidden="true">
              {#each c.sample.slice(0, 3) as s (s.id)}<SourceIcon feedId={s.id} hasIcon={s.hasIcon} name={s.title ?? '?'} size={22} />{/each}
            </span>
            <div class="meta">
              <span class="title">{c.name}</span>
              <span class="sub2">by <span class="who">{c.displayName ?? `@${c.handle}`}</span> · {c.feedCount} {c.feedCount === 1 ? 'feed' : 'feeds'}{#if c.description} · {c.description}{/if}</span>
            </div>
            <span class="chev" aria-hidden="true">›</span>
          </a>
        </li>
      {/each}
    </ul>
  {:else}
    <ul class="list">
      {#each users as u (u.handle)}
        <li>
          <a class="row" href={profileHref(u.handle)}>
            <Monogram name={u.displayName ?? u.handle} size={40} />
            <div class="meta">
              <span class="title">{u.displayName ?? u.handle} <span class="handle">@{u.handle}</span></span>
              <span class="sub2">
                {u.feeds} {u.feeds === 1 ? 'feed' : 'feeds'} · {u.collections} public {u.collections === 1 ? 'collection' : 'collections'}{#if u.notes !== null} · {u.notes} {u.notes === 1 ? 'note' : 'notes'}{/if}{#if u.bio} · {u.bio}{/if}
              </span>
            </div>
          </a>
          <button class="follow" class:on={u.isFollowing} onclick={() => toggleFollow(u)} disabled={followBusy === u.handle} aria-pressed={u.isFollowing}>{u.isFollowing ? 'Following' : 'Follow'}</button>
        </li>
      {/each}
    </ul>
  {/if}
  {#if loading}<p class="status">Loading…</p>{/if}
  <div bind:this={sentinel} aria-hidden="true"></div>
</section>

<style>
  .top { margin-bottom: 12px; }
  h1 { font-family: var(--font-serif); font-size: 26px; margin: 0; }
  .sub { margin: 2px 0 0; color: var(--text-3); font-size: 14px; }
  .views { display: flex; gap: 2px; padding: 3px; border-radius: 999px; background: var(--surface-2); margin-bottom: 16px; }
  .views button { flex: 1; padding: 8px 10px; border-radius: 999px; font-size: 13px; font-weight: 600; color: var(--text-2); white-space: nowrap; }
  .views button[aria-selected='true'] { background: var(--surface); color: var(--text); box-shadow: var(--shadow); }
  .head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
  .titles { min-width: 0; }
  h2 { font-family: var(--font-serif); font-size: 21px; margin: 0; }
  .count { color: var(--text-3); font-weight: 400; font-size: 15px; margin-left: 4px; font-family: var(--font); }
  .head p { margin: 4px 0 0; color: var(--text-2); font-size: 14px; }
  .add { flex: none; display: inline-flex; align-items: center; gap: 6px; padding: 9px 14px; border-radius: 999px; background: var(--accent); color: var(--accent-ink); font-size: 14px; font-weight: 600; white-space: nowrap; }
  .add span { font-size: 18px; line-height: 1; }
  .search { width: 100%; padding: 11px 14px; border-radius: 999px; border: 1px solid var(--line); background: var(--surface); color: var(--text); font-size: 15px; margin-bottom: 10px; }
  .filters { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; margin-bottom: 12px; }
  .filter { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-3); }
  .label { white-space: nowrap; }
  .check { flex-direction: row; align-items: center; gap: 8px; cursor: pointer; }
  .check input { width: 17px; height: 17px; accent-color: var(--accent); flex: none; }
  .check input:disabled { opacity: 0.45; }
  .check:has(input:disabled) { cursor: default; opacity: 0.55; }
  .filter select { padding: 6px 8px; border-radius: 999px; border: 1px solid var(--line); background: var(--surface); color: var(--text-2); font-size: 13px; }
  .list { list-style: none; margin: 0; padding: 0; background: var(--surface); border-radius: var(--radius); box-shadow: var(--shadow); overflow: hidden; }
  li { display: flex; align-items: center; gap: 10px; padding: 10px 14px 10px 12px; border-top: 1px solid var(--line); }
  li:first-child { border-top: 0; }
  .row { flex: 1; min-width: 0; display: flex; align-items: center; gap: 12px; }
  .meta { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .title { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .handle { font-weight: 400; color: var(--text-3); font-size: 13px; margin-left: 4px; }
  .sub2 { font-size: 13px; color: var(--text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .who { color: var(--text-2); font-weight: 600; }
  .net-n { color: var(--accent); font-weight: 600; }
  .bad { color: var(--danger); }
  .stack { display: inline-flex; flex: none; width: 40px; height: 40px; position: relative; }
  .stack :global(> *) { position: absolute; top: 9px; }
  .stack :global(> :nth-child(1)) { left: 0; z-index: 3; }
  .stack :global(> :nth-child(2)) { left: 9px; z-index: 2; }
  .stack :global(> :nth-child(3)) { left: 18px; z-index: 1; }
  .chev { color: var(--text-3); font-size: 20px; }
  .follow { flex: none; padding: 7px 14px; border-radius: 999px; border: 1px solid var(--accent); color: var(--accent); background: var(--surface); font-size: 13px; font-weight: 600; }
  .follow.on { background: color-mix(in srgb, var(--accent) 14%, transparent); border-color: transparent; }
  .follow:disabled { opacity: 0.6; }
  .status { text-align: center; color: var(--text-3); font-size: 14px; padding: 18px 0; margin: 0; }
  .status.error { color: var(--danger); }
  .empty { text-align: center; color: var(--text-2); padding: 34px 16px; font-size: 15px; }
  .empty p { margin: 0 auto; max-width: 440px; }
  .link { color: var(--accent); font-weight: 600; font-size: inherit; }
</style>
