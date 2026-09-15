<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import {
    api, bookmarksApi, exploreApi, searchApi, feedHref, collectionHref, profileHref, profilesApi,
    type Feed, type ExploreCollection, type ExploreUser,
    type SearchResults, type SearchScope, type SearchFeed, type SearchCollection, type SearchPost, type SearchPerson
  } from '$lib/api';
  import { feedOrigin, hostOf, longAgo, postRate, relativeTime } from '$lib/time';
  import { highlight, plural, shareOfOutput } from '$lib/words';
  import { feedListName } from '$lib/feedname';
  import { session } from '$lib/session.svelte';
  import { openAddFeed } from '$lib/addfeed.svelte';
  import SourceIcon from '$lib/components/SourceIcon.svelte';
  import FollowButton from '$lib/components/FollowButton.svelte';
  import Monogram from '$lib/components/Monogram.svelte';
  import { showToast } from '$lib/toast.svelte';

  /**
   * Explore is one search box over everything, plus the browse lists you land
   * on before you have typed anything.
   *
   * It used to be three tabs — feeds, collections, users — each running its own
   * search and never pooling the answers, so a search for a *topic* found
   * nothing: no feed is named "Mercedes", though plenty write about it. Now one
   * query goes to /api/search, which searches the posts and returns feeds and
   * collections as aggregations over what matched, and the tabs have become a
   * scope filter that narrows one answer instead of picking between four.
   *
   * With nothing typed the scope still selects a browse list, because an empty
   * search box should not produce an empty page and the index is worth looking
   * at unfiltered. Everything lives in the URL (?q=, ?scope=, filters) so any
   * view is a link.
   */
  const SCOPES: { id: SearchScope; label: string }[] = [
    { id: 'all', label: 'Everything' },
    { id: 'feeds', label: 'Feeds' },
    { id: 'collections', label: 'Collections' },
    { id: 'posts', label: 'Posts' },
    { id: 'people', label: 'People' }
  ];
  const q = $derived((page.url.searchParams.get('q') ?? '').trim());
  const scope = $derived(((page.url.searchParams.get('scope') as SearchScope | null) ?? 'all') as SearchScope);
  const searching = $derived(q.length > 0);
  /** With no query, Everything and Feeds both mean the index; Posts has no browse list. */
  const browseAs = $derived(scope === 'collections' ? 'collections' : scope === 'people' ? 'users' : 'feeds');

  /**
   * One filter, off by default: absent shows the whole index, 'following'
   * narrows to what the people you follow read.
   */
  const narrowToNetwork = $derived(page.url.searchParams.get('by') === 'following');
  const since = $derived(page.url.searchParams.get('since'));
  const sort = $derived(page.url.searchParams.get('sort') ?? 'recent');
  let followsAnyone = $state<boolean | null>(null);
  const feedsNetwork = $derived(narrowToNetwork ? '1' : null);

  function setParams(patch: Record<string, string | null>) {
    const p = new URLSearchParams(page.url.searchParams);
    for (const [k, v] of Object.entries(patch)) v ? p.set(k, v) : p.delete(k);
    void goto(`/feeds${p.size ? `?${p}` : ''}`, { replaceState: true, keepFocus: true });
  }
  function setScope(s: SearchScope) {
    setParams({ scope: s === 'all' ? null : s, since: null, sort: null });
    api.event('explore_scope', { scope: s, searching });
  }

  let draft = $state('');
  let timer: ReturnType<typeof setTimeout>;
  function onSearch(v: string) {
    draft = v;
    clearTimeout(timer);
    timer = setTimeout(() => setParams({ q: v.trim() || null }), 250);
  }

  /* ---- search ---- */
  let res = $state<SearchResults | null>(null);
  /** Rows for a narrowed scope, accumulated across pages. */
  let more = $state<(SearchFeed | SearchCollection | SearchPost | SearchPerson)[]>([]);
  let moreNext = $state<number | null>(null);
  const group = $derived(res && scope !== 'all' ? res[scope] : null);
  const found = $derived(res ? res.feeds.total + res.collections.total + res.posts.total + res.people.total : 0);
  function countFor(s: SearchScope) {
    if (!res) return null;
    return s === 'all' ? found : res[s].total;
  }

  async function loadSearch(reset = false) {
    if (loading || (!reset && scope !== 'all' && moreNext === null)) return;
    loading = true; error = null;
    try {
      const r = await searchApi.run({ q, scope, limit: 25, offset: reset ? 0 : moreNext ?? 0 });
      res = r;
      if (scope === 'all') { more = []; moreNext = null; }
      else { more = reset ? r[scope].rows : [...more, ...r[scope].rows]; moreNext = r[scope].nextOffset; }
    } catch (e) { error = e instanceof Error ? e.message : String(e); } finally { loading = false; }
  }

  /* ---- browse: feeds ---- */
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
      const r = await api.feeds({ network: feedsNetwork, since, sort, limit: 50, offset: reset ? 0 : feedsNext ?? 0 });
      feeds = reset ? r.feeds : [...feeds, ...r.feeds];
      feedsTotal = r.total; feedsAll = r.indexTotal; feedsNext = r.nextOffset;
    } catch (e) { error = e instanceof Error ? e.message : String(e); } finally { loading = false; }
  }

  /* ---- browse: collections ---- */
  let cols = $state<ExploreCollection[]>([]);
  let colsTotal = $state(0);
  let colsNext = $state<number | null>(null);
  async function loadCols(reset = false) {
    if (loading || (!reset && colsNext === null)) return;
    loading = true; error = null;
    try {
      const r = await exploreApi.collections({ network: narrowToNetwork, limit: 30, offset: reset ? 0 : colsNext ?? 0 });
      cols = reset ? r.collections : [...cols, ...r.collections];
      colsTotal = r.total; colsNext = r.nextOffset;
    } catch (e) { error = e instanceof Error ? e.message : String(e); } finally { loading = false; }
  }

  /* ---- browse: people ---- */
  let users = $state<ExploreUser[]>([]);
  let usersTotal = $state(0);
  let usersNext = $state<number | null>(null);
  async function loadUsers(reset = false) {
    if (loading || (!reset && usersNext === null)) return;
    loading = true; error = null;
    try {
      const r = await exploreApi.users({ limit: 30, offset: reset ? 0 : usersNext ?? 0 });
      users = reset ? r.users : [...users, ...r.users];
      usersTotal = r.total; usersNext = r.nextOffset;
    } catch (e) { error = e instanceof Error ? e.message : String(e); } finally { loading = false; }
  }

  /* ---- verbs ---- */
  let followBusy = $state<string | null>(null);
  async function toggleFollow(u: { handle: string; displayName: string | null; isFollowing: boolean }) {
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

  let markBusy = $state<number | null>(null);
  async function toggleBookmark(p: SearchPost) {
    if (markBusy) return;
    markBusy = p.id;
    try {
      if (p.bookmarkId) { await bookmarksApi.remove(p.bookmarkId); p.bookmarkId = null; showToast('Removed from saved'); }
      else { const b = await bookmarksApi.saveItem(p.id); p.bookmarkId = b.id; api.event('bookmark_saved', { itemId: p.id, via: 'search' }); showToast('Saved'); }
    } catch (e) { showToast(e instanceof Error ? e.message : String(e)); } finally { markBusy = null; }
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

  function loadMore() {
    if (searching) void loadSearch();
    else if (browseAs === 'feeds') void loadFeeds();
    else if (browseAs === 'collections') void loadCols();
    else void loadUsers();
  }

  $effect(() => {
    if (followsAnyone === null) return; // wait until we know the default
    const key = `${q}|${scope}|${feedsNetwork}|${since}|${sort}`;
    if (loadedKey === key) return;
    loadedKey = key;
    if (searching) { res = null; more = []; moreNext = null; void loadSearch(true); }
    else if (browseAs === 'feeds') { feeds = []; feedsNext = null; void loadFeeds(true); }
    else if (browseAs === 'collections') { cols = []; colsNext = null; void loadCols(true); }
    else { users = []; usersNext = null; void loadUsers(true); }
  });
  $effect(() => {
    if (!sentinel) return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) loadMore(); }, { rootMargin: '800px 0px' });
    io.observe(sentinel);
    return () => io.disconnect();
  });

  const browseTotal = $derived(browseAs === 'feeds' ? feedsTotal : browseAs === 'collections' ? colsTotal : usersTotal);
  const browseCount = $derived(
    browseAs !== 'feeds' || feedsTotal === feedsAll || !feedsAll
      ? browseTotal.toLocaleString()
      : `${feedsTotal.toLocaleString()} of ${feedsAll.toLocaleString()}`
  );
  /** Empty is per scope, not per query: "no people match" while 300 posts do. */
  const nothing = $derived(
    !loading && (searching
      ? res !== null && (scope === 'all' ? found === 0 : res[scope].total === 0)
      : (browseAs === 'feeds' ? feeds.length : browseAs === 'collections' ? cols.length : users.length) === 0)
  );
  const scopeLabel = $derived(SCOPES.find((s) => s.id === scope)?.label ?? '');
</script>

<svelte:head><title>{searching ? `${q} · Explore` : 'Explore'} · thicket</title></svelte:head>

<header class="top">
  <h1>Explore</h1>
  <p class="sub">One search across the feeds this instance knows about, the collections people have shared, everything those feeds have published, and the people here.</p>
</header>

<section class="pane">
  <div class="head">
    <input
      class="search" type="search" value={draft} oninput={(e) => onSearch(e.currentTarget.value)}
      placeholder="Search for anything — a topic, a site, a person" aria-label="Search"
    />
    {#if !searching && browseAs === 'feeds'}
      <button class="add" onclick={() => openAddFeed({ via: 'explore' })}><span aria-hidden="true">+</span> Add a new feed</button>
    {/if}
  </div>

  <div class="scopes" role="tablist" aria-label="What to search">
    {#each SCOPES as s (s.id)}
      {#if searching || s.id !== 'posts'}
        {@const n = searching ? countFor(s.id) : null}
        <button role="tab" aria-selected={scope === s.id} onclick={() => setScope(s.id)} disabled={searching && n === 0}>
          {s.label}{#if n !== null}<span class="n">{n.toLocaleString()}</span>{/if}
        </button>
      {/if}
    {/each}
  </div>

  {#if !searching}
    <div class="titles">
      {#if browseAs === 'feeds'}
        <h2>Every feed here <span class="count">{browseCount}</span></h2>
        <p>The ones people on this instance read, and a few thousand more it was seeded with. Search above to look inside what they publish, not just at their names.</p>
      {:else if browseAs === 'collections'}
        <h2>Collections people have shared <span class="count">{browseCount}</span></h2>
        <p>Browse collections of feeds curated by other people and copy them to your profile.</p>
      {:else}
        <h2>People here <span class="count">{browseCount}</span></h2>
        <p>Public profiles you can browse and follow, to see their notes and what they read.</p>
      {/if}
    </div>
    <div class="filters">
      <label class="filter check" title={followsAnyone === false ? 'Follow someone first' : ''}>
        <input type="checkbox" checked={narrowToNetwork} disabled={followsAnyone === false || browseAs === 'users'}
               onchange={(e) => setParams({ by: e.currentTarget.checked ? 'following' : null })} />
        <span class="label">{browseAs === 'collections' ? 'Only from people I follow' : 'Only what people I follow read'}</span>
      </label>
      {#if browseAs === 'feeds'}
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
            {#each sorts as s (s.id)}<option value={s.id}>{s.label}</option>{/each}
          </select>
        </label>
      {/if}
    </div>
  {/if}
</section>

<!-- Rows. Each kind knows how to show its own evidence; see lib/words.ts. -->
{#snippet feedRow(f: SearchFeed | Feed, ev: SearchFeed | null)}
  <li>
    <a class="row" href={feedHref(f)}>
      <SourceIcon feedId={f.id} hasIcon={f.hasIcon} name={f.title ?? hostOf(f.url)} size={40} />
      <div class="meta">
        <span class="title">{feedListName(f)}</span>
        {#if f.description}<span class="desc">{f.description}</span>{/if}
        {#if ev && ev.matches > 0}
          <span class="why">
            <strong>{plural(ev.matches, 'post')}</strong> about “{q}”
            {#if shareOfOutput(ev.matches, ev.posts)} · {shareOfOutput(ev.matches, ev.posts)}{/if}
            {#if ev.lastMatchAt} · most recent {longAgo(ev.lastMatchAt)}{/if}
          </span>
        {:else if ev}
          <span class="why muted">Matches the name · nothing it has published mentions “{q}”</span>
        {/if}
        <span class="sub2">
          {feedOrigin(f)}
          {#if f.lastItemAt} · last post {longAgo(f.lastItemAt)}{/if}
          {#if f.postsLast30d} · {postRate(f.postsLast30d)}{/if}
          {#if !ev && feedsNetwork && (f as Feed).networkFollowers} · <span class="net-n">{(f as Feed).networkFollowers} {(f as Feed).networkFollowers === 1 ? 'person' : 'people'} you follow</span>{/if}
          {#if f.consecutiveFailures >= 3} · <span class="bad">failing</span>{/if}
        </span>
      </div>
    </a>
    <FollowButton feedId={f.id} bind:ids={f.myCollectionIds} name={f.title ?? hostOf(f.url)} compact onchange={() => void api.feed(f.id).then((u) => Object.assign(f, u))} />
  </li>
{/snippet}

{#snippet colRow(c: ExploreCollection | SearchCollection, ev: SearchCollection | null)}
  <li>
    <a class="row" href={collectionHref(c.handle, c.slug)}>
      <span class="stack" aria-hidden="true">
        {#each c.sample.slice(0, 3) as s (s.id)}<SourceIcon feedId={s.id} hasIcon={s.hasIcon} name={s.title ?? '?'} size={22} />{/each}
      </span>
      <div class="meta">
        <span class="title">{c.name}</span>
        {#if ev && ev.matches > 0}
          <span class="why">
            <strong>{plural(ev.matchingFeeds, 'feed')}</strong> in it {ev.matchingFeeds === 1 ? 'has' : 'have'} posted about “{q}”
            {#if ev.lastMatchAt} · most recent {longAgo(ev.lastMatchAt)}{/if}
          </span>
        {:else if ev}
          <span class="why muted">Matches the name</span>
        {/if}
        <span class="sub2">by <span class="who">{c.displayName ?? `@${c.handle}`}</span> · {plural(c.feedCount, 'feed')}{#if c.description} · {c.description}{/if}</span>
      </div>
      <span class="chev" aria-hidden="true">›</span>
    </a>
  </li>
{/snippet}

{#snippet postRow(p: SearchPost)}
  <li>
    <a class="row" href={p.url ?? feedHref({ id: p.feedId })} target={p.url ? '_blank' : undefined} rel={p.url ? 'noreferrer' : undefined}>
      <SourceIcon feedId={p.feedId} hasIcon={p.hasIcon} name={p.feedTitle ?? ''} size={40} />
      <div class="meta">
        <span class="title">{p.title ?? p.url}</span>
        {#if p.snippet}
          <span class="desc">{#each highlight(p.snippet) as part}{#if part.hit}<mark>{part.text}</mark>{:else}{part.text}{/if}{/each}</span>
        {/if}
        <!-- Plenty of feeds set the author to the feed's own name; saying it twice is noise. -->
        <span class="sub2">{p.feedTitle ?? hostOf(p.siteUrl)} · {relativeTime(p.publishedAt)}{#if p.author && p.author !== p.feedTitle}<span>{' · ' + p.author}</span>{/if}</span>
      </div>
    </a>
    {#if session.user}
      <button class="save" class:on={!!p.bookmarkId} onclick={() => toggleBookmark(p)} disabled={markBusy === p.id} aria-pressed={!!p.bookmarkId}>
        {p.bookmarkId ? 'Saved' : 'Save'}
      </button>
    {/if}
  </li>
{/snippet}

{#snippet personRow(u: ExploreUser | SearchPerson, ev: SearchPerson | null)}
  <li>
    <a class="row" href={profileHref(u.handle)}>
      <Monogram name={u.displayName ?? u.handle} size={40} />
      <div class="meta">
        <span class="title">{u.displayName ?? u.handle} <span class="handle">@{u.handle}</span></span>
        {#if ev && ev.notesMatch + ev.marksMatch > 0}
          <span class="why">
            {#if ev.notesMatch}<strong>{plural(ev.notesMatch, 'note')}</strong> about “{q}”{/if}
            {#if ev.notesMatch && ev.marksMatch} · {/if}
            {#if ev.marksMatch}<strong>{plural(ev.marksMatch, 'saved post')}</strong> about “{q}”{/if}
          </span>
        {/if}
        <span class="sub2">
          {plural(u.feeds, 'feed')} · {u.collections} public {u.collections === 1 ? 'collection' : 'collections'}{#if u.bio} · {u.bio}{/if}
        </span>
      </div>
    </a>
    <button class="follow" class:on={u.isFollowing} onclick={() => toggleFollow(u)} disabled={followBusy === u.handle} aria-pressed={u.isFollowing}>{u.isFollowing ? 'Following' : 'Follow'}</button>
  </li>
{/snippet}

{#if error}
  <p class="status error">Couldn’t load: {error}</p>
{:else if nothing}
  <div class="empty">
    {#if searching && scope !== 'all' && found > 0}
      <p>No {scopeLabel.toLowerCase()} match “{q}”, but {plural(found, 'other result')} {found === 1 ? 'does' : 'do'}. <button class="link" onclick={() => setScope('all')}>Show everything</button>.</p>
    {:else if searching}
      <p>Nothing here matches “{q}”. Search looks at feed names and descriptions, the posts those feeds have published, collection names, and people’s profiles.</p>
    {:else if browseAs === 'feeds'}
      {#if feedsNetwork}<p>The people you follow haven’t followed anything you don’t already. <button class="link" onclick={() => setParams({ by: null })}>Show the whole index</button>.</p>
      {:else if since}<p>Nothing was added in that time.</p>
      {:else}<p>Nobody has added a feed yet. Be the first: press <strong>Add a new feed</strong> and paste a site’s address.</p>{/if}
    {:else if browseAs === 'collections'}
      {#if narrowToNetwork}<p>The people you follow haven’t shared any collections yet. <button class="link" onclick={() => setParams({ by: null })}>Show everyone’s</button>.</p>
      {:else}<p>No one has shared a public collection yet. Yours could be first: open a collection, Manage, and set it to Public.</p>{/if}
    {:else}
      <p>No other public profiles here yet.</p>
    {/if}
  </div>
{:else if searching && res}
  {#if scope === 'all'}
    {#if res.feeds.rows.length}
      <section class="group">
        <h2>Feeds <span class="count">{res.feeds.total.toLocaleString()}</span>{#if res.feeds.total > res.feeds.rows.length}<button class="link all" onclick={() => setScope('feeds')}>See all</button>{/if}</h2>
        <ul class="list">{#each res.feeds.rows as f (f.id)}{@render feedRow(f, f)}{/each}</ul>
      </section>
    {/if}
    {#if res.collections.rows.length}
      <section class="group">
        <h2>Collections <span class="count">{res.collections.total.toLocaleString()}</span>{#if res.collections.total > res.collections.rows.length}<button class="link all" onclick={() => setScope('collections')}>See all</button>{/if}</h2>
        <ul class="list">{#each res.collections.rows as c (c.id)}{@render colRow(c, c)}{/each}</ul>
      </section>
    {/if}
    {#if res.posts.rows.length}
      <section class="group">
        <h2>Posts <span class="count">{res.posts.total.toLocaleString()}</span>{#if res.posts.total > res.posts.rows.length}<button class="link all" onclick={() => setScope('posts')}>See all</button>{/if}</h2>
        <ul class="list">{#each res.posts.rows as p (p.id)}{@render postRow(p)}{/each}</ul>
      </section>
    {/if}
    {#if res.people.rows.length}
      <section class="group">
        <h2>People <span class="count">{res.people.total.toLocaleString()}</span>{#if res.people.total > res.people.rows.length}<button class="link all" onclick={() => setScope('people')}>See all</button>{/if}</h2>
        <ul class="list">{#each res.people.rows as u (u.handle)}{@render personRow(u, u)}{/each}</ul>
      </section>
    {/if}
  {:else}
    <section class="group">
      <h2>{SCOPES.find((s) => s.id === scope)?.label} <span class="count">{(group?.total ?? 0).toLocaleString()}</span></h2>
      <ul class="list">
        {#if scope === 'feeds'}{#each more as f (( f as SearchFeed).id)}{@render feedRow(f as SearchFeed, f as SearchFeed)}{/each}
        {:else if scope === 'collections'}{#each more as c ((c as SearchCollection).id)}{@render colRow(c as SearchCollection, c as SearchCollection)}{/each}
        {:else if scope === 'posts'}{#each more as p ((p as SearchPost).id)}{@render postRow(p as SearchPost)}{/each}
        {:else}{#each more as u ((u as SearchPerson).handle)}{@render personRow(u as SearchPerson, u as SearchPerson)}{/each}{/if}
      </ul>
    </section>
  {/if}
{:else if browseAs === 'feeds'}
  <ul class="list">{#each feeds as f (f.id)}{@render feedRow(f, null)}{/each}</ul>
{:else if browseAs === 'collections'}
  <ul class="list">{#each cols as c (c.id)}{@render colRow(c, null)}{/each}</ul>
{:else}
  <ul class="list">{#each users as u (u.handle)}{@render personRow(u, null)}{/each}</ul>
{/if}

{#if loading}<p class="status">Loading…</p>{/if}
<div bind:this={sentinel} aria-hidden="true"></div>

<style>
  .top { margin-bottom: 12px; }
  h1 { font-family: var(--font-headings); font-size: 26px; margin: 0; }
  .sub { margin: 2px 0 0; color: var(--text-3); font-size: 14px; max-width: 62ch; }
  .pane { margin-bottom: 16px; }
  .head { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
  .search { flex: 1; min-width: 0; padding: 12px 16px; border-radius: 999px; border: 1px solid var(--line); background: var(--surface); color: var(--text); font-size: 16px; }
  .add { flex: none; display: inline-flex; align-items: center; gap: 6px; padding: 10px 14px; border-radius: 999px; background: var(--accent); color: var(--accent-ink); font-size: 14px; font-weight: 600; white-space: nowrap; }
  .add span { font-size: 18px; line-height: 1; }
  .scopes { display: flex; gap: 2px; padding: 3px; border-radius: 999px; background: var(--surface-2); margin-bottom: 14px; overflow-x: auto; }
  .scopes button { flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 8px 10px; border-radius: 999px; font-size: 13px; font-weight: 600; color: var(--text-2); white-space: nowrap; }
  .scopes button[aria-selected='true'] { background: var(--surface); color: var(--text); box-shadow: var(--shadow); }
  .scopes button:disabled { opacity: 0.4; }
  .scopes .n { font-weight: 400; color: var(--text-3); font-variant-numeric: tabular-nums; }
  .titles { min-width: 0; margin-bottom: 12px; }
  h2 { font-family: var(--font-headings); font-size: 21px; margin: 0; display: flex; align-items: baseline; gap: 8px; }
  .count { color: var(--text-3); font-weight: 400; font-size: 15px; font-family: var(--font); font-variant-numeric: tabular-nums; }
  .titles p { margin: 4px 0 0; color: var(--text-2); font-size: 14px; max-width: 68ch; }
  .group { margin-bottom: 22px; }
  .group h2 { margin-bottom: 8px; }
  .all { margin-left: auto; font-size: 14px; }
  .filters { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; }
  .filter { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-3); }
  .label { white-space: nowrap; }
  .check { flex-direction: row; align-items: center; gap: 8px; cursor: pointer; }
  .check input { width: 17px; height: 17px; accent-color: var(--accent); flex: none; }
  .check input:disabled { opacity: 0.45; }
  .check:has(input:disabled) { cursor: default; opacity: 0.55; }
  .filter select { padding: 6px 8px; border-radius: 999px; border: 1px solid var(--line); background: var(--surface); color: var(--text-2); font-size: 13px; }
  .list { list-style: none; margin: 0; padding: 0; background: var(--surface); border-radius: var(--radius); box-shadow: var(--shadow); overflow: hidden; }
  li { display: flex; align-items: center; gap: 10px; padding: 10px 14px 10px 12px; border-top: 1px solid var(--line); flex-wrap: wrap; }
  /* On a phone the Follow control would squeeze the description into a column
     four words wide, so it drops to its own line and the text gets the row. */
  @media (max-width: 560px) {
    li > :global(.row) { flex-basis: 100%; }
    li > :global(.split) { margin-left: auto; }
  }
  li:first-child { border-top: 0; }
  .row { flex: 1; min-width: 0; display: flex; align-items: center; gap: 12px; }
  .meta { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .title { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .handle { font-weight: 400; color: var(--text-3); font-size: 13px; margin-left: 4px; }
  /* Wraps rather than truncates: every part of it is a fact someone is deciding on. */
  .sub2 { font-size: 13px; color: var(--text-3); }
  .desc { font-size: 13px; color: var(--text-2); margin: 2px 0 3px; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .desc mark { background: color-mix(in srgb, var(--accent) 28%, transparent); color: inherit; border-radius: 3px; padding: 0 1px; }
  /* Why this row is here: the same numbers the ranking is made of, in words. */
  .why { font-size: 13px; color: var(--accent); margin: 2px 0 1px; }
  .why strong { font-weight: 700; }
  .why.muted { color: var(--text-3); }
  .who { color: var(--text-2); font-weight: 600; }
  .net-n { color: var(--accent); font-weight: 600; }
  .bad { color: var(--danger); }
  .stack { display: inline-flex; flex: none; width: 40px; height: 40px; position: relative; }
  .stack :global(> *) { position: absolute; top: 9px; }
  .stack :global(> :nth-child(1)) { left: 0; z-index: 3; }
  .stack :global(> :nth-child(2)) { left: 9px; z-index: 2; }
  .stack :global(> :nth-child(3)) { left: 18px; z-index: 1; }
  .chev { color: var(--text-3); font-size: 20px; }
  .follow, .save { flex: none; padding: 7px 14px; border-radius: 999px; border: 1px solid var(--accent); color: var(--accent); background: var(--surface); font-size: 13px; font-weight: 600; }
  .follow.on, .save.on { background: color-mix(in srgb, var(--accent) 14%, transparent); border-color: transparent; }
  .follow:disabled, .save:disabled { opacity: 0.6; }
  .status { text-align: center; color: var(--text-3); font-size: 14px; padding: 18px 0; margin: 0; }
  .status.error { color: var(--danger); }
  .empty { text-align: center; color: var(--text-2); padding: 34px 16px; font-size: 15px; }
  .empty p { margin: 0 auto; max-width: 480px; }
  .link { color: var(--accent); font-weight: 600; font-size: inherit; }
</style>
