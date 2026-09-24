<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import {
    api, bookmarksApi, exploreApi, searchApi, feedHref, collectionHref, profileHref, profilesApi,
    type Feed, type ExploreCollection, type ExploreUser,
    type SearchResults, type SearchScope, type SearchFeed, type SearchCollection, type SearchPost, type SearchPerson
  } from '$lib/api';
  import { feedOrigin, hostOf, longAgo, postRate, relativeTime, webHref } from '$lib/time';
  import { highlight, latestShort, mentionRate, plural } from '$lib/words';
  import { feedListName } from '$lib/feedname';
  import { session } from '$lib/session.svelte';
  import AddFeedButton from '$lib/components/AddFeedButton.svelte';
  import Field from '$lib/components/Field.svelte';
  import Input from '$lib/components/Input.svelte';
  import Select from '$lib/components/Select.svelte';
  import SourceIcon from '$lib/components/SourceIcon.svelte';
  import FollowControl from '$lib/components/FollowControl.svelte';
  import Avatar from '$lib/components/Avatar.svelte';
  import Tabs from '$lib/components/Tabs.svelte';
  import Badge from '$lib/components/Badge.svelte';
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
  /**
   * One line under the tabs saying what the selected tab shows. Fixed spot, one
   * per scope, on every view — the tabs pick the view, this says what it is.
   */
  const SCOPE_BLURB: Record<SearchScope, string> = {
    all: 'Feeds, collections, posts, and people, together in one search.',
    feeds: 'Sites that publish a feed. Follow one and its posts arrive in your stream.',
    collections: 'Topical sets of feeds people share, so you can follow along.',
    posts: 'Individual posts from across every feed on thicket.',
    people: 'Public profiles you can browse and follow.'
  };
  /**
   * Bind the last two words with a non-breaking space so the caption can never
   * wrap to a single orphaned word on its final line, at any width.
   */
  const noOrphan = (s: string) => s.replace(/ (\S+)$/, ' $1');
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
    void goto(`/explore${p.size ? `?${p}` : ''}`, { replaceState: true, keepFocus: true });
  }
  function setScope(s: SearchScope) {
    setParams({ scope: s === 'all' ? null : s, since: null, sort: null });
    api.event('explore_scope', { scope: s, searching });
  }

  let draft = $state('');
  let searchInput = $state<HTMLInputElement | null>(null);
  let timer: ReturnType<typeof setTimeout>;
  function onSearch(v: string) {
    draft = v;
    clearTimeout(timer);
    timer = setTimeout(() => setParams({ q: v.trim() || null }), 250);
  }
  function clearSearch() {
    draft = '';
    clearTimeout(timer);
    setParams({ q: null });
    searchInput?.focus();
  }

  /* ---- search ---- */
  let res = $state<SearchResults | null>(null);
  /** Rows for a narrowed scope, accumulated across pages. */
  let more = $state<(SearchFeed | SearchCollection | SearchPost | SearchPerson)[]>([]);
  let moreNext = $state<number | null>(null);
  /**
   * The scope `more` was loaded for. Switching tabs redraws the list before the
   * new search is even sent, and drawing feed rows as collections crashed the
   * page, so rows only show under the tab they came from.
   */
  let moreScope = $state<SearchScope | null>(null);
  const rows = $derived(moreScope === scope ? more : []);
  const group = $derived(res && scope !== 'all' ? res[scope] : null);
  const found = $derived(res ? res.feeds.total + res.collections.total + res.posts.total + res.people.total : 0);
  function countFor(s: SearchScope) {
    if (!res) return null;
    return s === 'all' ? found : res[s].total;
  }
  /* Posts only make sense once something is typed, and a scope with nothing in
     it is shown but switched off, so the counts still say "nothing here". */
  const scopeTabs = $derived(
    SCOPES.filter((s) => searching || s.id !== 'posts').map((s) => {
      const n = searching ? countFor(s.id) : null;
      return {
        value: s.id,
        label: s.label,
        count: n === null ? undefined : n.toLocaleString(),
        disabled: n === 0
      };
    })
  );

  /**
   * Every list on the page loads through here. A fresh load (reset) always goes
   * out, even with an older one in flight, and an answer that arrives after the
   * view changed is dropped, so a slow reply for the last tab or search can never
   * land on this one. Each request also gets its own number, because someone can
   * leave a view and return to it while its first request is still in flight.
   * `loading` belongs to the newest request alone: an outdated request neither
   * clears it nor blocks the new view's load, which is what left the page stuck
   * on "Loading…" when a search was cleared mid-request. Scrolling for more (not
   * a reset) waits its turn and stops at the end.
   */
  let latestLoad = 0;
  async function load<T>(reset: boolean, hasMore: boolean, request: () => Promise<T>, apply: (r: T) => void) {
    if (!reset && (loading || !hasMore)) return;
    const key = loadedKey;
    const id = ++latestLoad;
    const isCurrent = () => key === loadedKey && id === latestLoad;
    loading = true; error = null;
    try {
      const r = await request();
      if (isCurrent()) apply(r);
    } catch (e) { if (isCurrent()) error = e instanceof Error ? e.message : String(e); } finally { if (isCurrent()) loading = false; }
  }

  function loadSearch(reset = false) {
    const s = scope;
    return load(reset, s === 'all' || moreNext !== null,
      () => searchApi.run({ q, scope: s, limit: 25, offset: reset ? 0 : moreNext ?? 0, network: feedsNetwork }),
      (r) => {
        res = r;
        if (s === 'all') { more = []; moreNext = null; }
        else { more = reset ? r[s].rows : [...more, ...r[s].rows]; moreNext = r[s].nextOffset; }
        moreScope = s;
      });
  }

  /* ---- browse: feeds ---- */
  let feeds = $state<Feed[]>([]);
  let feedsTotal = $state(0);
  let feedsAll = $state(0);
  let feedsNext = $state<number | null>(null);
  const sorts = [
    { id: 'recent', label: 'Recent posts' },
    { id: 'followers', label: 'Followers' },
    { id: 'posts', label: 'Most active' },
    { id: 'title', label: 'A–Z' },
    { id: 'added', label: 'Newest here' }
  ];
  function loadFeeds(reset = false) {
    return load(reset, feedsNext !== null,
      () => api.feeds({ network: feedsNetwork, since, sort, limit: 50, offset: reset ? 0 : feedsNext ?? 0 }),
      (r) => {
        feeds = reset ? r.feeds : [...feeds, ...r.feeds];
        feedsTotal = r.total; feedsAll = r.indexTotal; feedsNext = r.nextOffset;
      });
  }

  /* ---- browse: collections ---- */
  let cols = $state<ExploreCollection[]>([]);
  let colsTotal = $state(0);
  let colsNext = $state<number | null>(null);
  function loadCols(reset = false) {
    return load(reset, colsNext !== null,
      () => exploreApi.collections({ network: narrowToNetwork, limit: 30, offset: reset ? 0 : colsNext ?? 0 }),
      (r) => {
        cols = reset ? r.collections : [...cols, ...r.collections];
        colsTotal = r.total; colsNext = r.nextOffset;
      });
  }

  /* ---- browse: people ---- */
  let users = $state<ExploreUser[]>([]);
  let usersTotal = $state(0);
  let usersNext = $state<number | null>(null);
  function loadUsers(reset = false) {
    return load(reset, usersNext !== null,
      () => exploreApi.users({ limit: 30, offset: reset ? 0 : usersNext ?? 0 }),
      (r) => {
        users = reset ? r.users : [...users, ...r.users];
        usersTotal = r.total; usersNext = r.nextOffset;
      });
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
    // The "Everything" scope isn't paginated (it shows a fixed top slice per kind),
    // so its sentinel must not re-run the same page-0 search on every scroll.
    if (searching) { if (scope !== 'all') void loadSearch(); }
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
  <div class="titlerow">
    <h1>Explore</h1>
    <AddFeedButton via="explore" />
  </div>
  <p class="sub">Find feeds, collections, posts, and people<span class="tail">, all in one search.</span></p>
</header>

<section class="pane">
  <div class="head">
    <Field label="Search" hideLabel>
      {#snippet children({ id })}
        <Input
          {id}
          bind:element={searchInput}
          variant="search"
          size="lg"
          value={draft}
          oninput={(e) => onSearch(e.currentTarget.value)}
          onclear={clearSearch}
          placeholder="Search for anything"
        />
      {/snippet}
    </Field>
  </div>

  <Tabs
    class="scopes"
    tabs={scopeTabs}
    value={scope}
    onchange={(v) => setScope(v as SearchScope)}
    label="What to search"
    fill
  />
</section>

<!-- The filters that act on a browse list. Rendered as the list card's header
     when browsing (attached to what they control), and as a plain bar above the
     stacked result cards when searching. -->
{#snippet scopeIcon(s: SearchScope)}
  <svg class="blurb-i" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    {#if s === 'feeds'}<path d="M4 11a9 9 0 0 1 9 9" /><path d="M4 4a16 16 0 0 1 16 16" /><circle cx="5" cy="19" r="1" />
    {:else if s === 'collections'}<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.57 3.9a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" /><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65" /><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65" />
    {:else if s === 'posts'}<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /><path d="M16 13H8" /><path d="M16 17H8" /><path d="M10 9H8" />
    {:else if s === 'people'}<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
    {:else}<rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" />
    {/if}
  </svg>
{/snippet}

{#snippet filterBar()}
  <p class="blurb">{@render scopeIcon(scope)}<span>{noOrphan(SCOPE_BLURB[scope])}</span></p>
  <div class="filters">
    <Select
      class="filter"
      label="Show"
      size="sm"
      title={followsAnyone === false ? 'Follow someone first' : ''}
      value={narrowToNetwork ? 'following' : ''}
      disabled={browseAs === 'users'}
      options={[
        { value: '', label: 'Everyone' },
        { value: 'following', label: 'People I follow', disabled: followsAnyone === false }
      ]}
      onchange={(e) => setParams({ by: e.currentTarget.value === 'following' ? 'following' : null })}
    />
    {#if !searching && browseAs === 'feeds'}
      <Select
        class="filter"
        label="Added"
        size="sm"
        value={since ?? ''}
        options={[
          { value: '', label: 'any time' },
          { value: '24h', label: '24 hours' },
          { value: 'week', label: 'week' },
          { value: 'month', label: 'month' },
          { value: 'year', label: 'year' }
        ]}
        onchange={(e) => setParams({ since: e.currentTarget.value || null })}
      />
      <Select
        class="filter"
        label="Sort"
        size="sm"
        value={sort}
        options={sorts.map((s) => ({ value: s.id, label: s.label }))}
        onchange={(e) => setParams({ sort: e.currentTarget.value === 'recent' ? null : e.currentTarget.value })}
      />
    {/if}
  </div>
{/snippet}

<!-- Rows. Each kind knows how to show its own evidence; see lib/words.ts. -->
{#snippet feedRow(f: SearchFeed | Feed, ev: SearchFeed | null)}
  <li>
    <a class="row" href={feedHref(f)}>
      <SourceIcon feedId={f.id} hasIcon={f.hasIcon} name={f.title ?? hostOf(f.url)} size={40} />
      <div class="meta">
        <span class="title">{feedListName(f)}</span>
        <span class="sub2 byline">
          {feedOrigin(f)}
          {#if f.postsLast30d} · publishes about {postRate(f.postsLast30d)}{/if}
          {#if !ev && f.lastItemAt} · latest {longAgo(f.lastItemAt)}{/if}
          {#if !ev && feedsNetwork && (f as Feed).networkFollowers} · <span class="net-n">{(f as Feed).networkFollowers} {(f as Feed).networkFollowers === 1 ? 'person' : 'people'} you follow</span>{/if}
          {#if f.consecutiveFailures >= 3} · <span class="bad">failing</span>{/if}
        </span>
        {#if f.description}<span class="desc">{f.description}</span>{/if}
        {#if ev && ev.matchesLast30d > 0}
          <span class="why"><span aria-hidden="true">~</span><span class="visually-hidden">about </span>{mentionRate(ev.matchesLast30d)} “{q}”{#if ev.lastMatchAt}{' '}<span class="nowrap">({latestShort(ev.lastMatchAt)})</span>{/if}</span>
        {:else if ev && ev.lastMatchAt}
          <span class="why">Last mentioned “{q}” {longAgo(ev.lastMatchAt)}</span>
        {:else if ev}
          <span class="why">Name matches, but no posts mention “{q}”</span>
        {/if}
      </div>
    </a>
    <FollowControl feedId={f.id} bind:ids={f.myCollectionIds} name={f.title ?? hostOf(f.url)} compact onchange={() => void api.feed(f.id).then((u) => Object.assign(f, u))} />
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
          <span class="why">Matches the name</span>
        {/if}
        <span class="sub2">by <span class="who">{c.displayName ?? `@${c.handle}`}</span> · {plural(c.feedCount, 'feed')}{#if c.description} · {c.description}{/if}</span>
      </div>
      <span class="chev" aria-hidden="true">›</span>
    </a>
  </li>
{/snippet}

{#snippet postRow(p: SearchPost)}
  <li>
    <a class="row" href={webHref(p.url) ?? feedHref({ id: p.feedId })} target={webHref(p.url) ? '_blank' : undefined} rel={webHref(p.url) ? 'noreferrer' : undefined}>
      <SourceIcon feedId={p.feedId} hasIcon={p.hasIcon} name={p.feedTitle ?? ''} size={40} />
      <div class="meta">
        <span class="title">{p.title ?? p.url}</span>
        <!-- Plenty of feeds set the author to the feed's own name; saying it twice is noise. -->
        <span class="sub2 byline">{p.feedTitle ?? hostOf(p.siteUrl)} · {relativeTime(p.publishedAt)}{#if p.author && p.author !== p.feedTitle}<span>{' · ' + p.author}</span>{/if}</span>
        {#if p.snippet}
          <span class="desc">{#each highlight(p.snippet) as part}{#if part.hit}<mark>{part.text}</mark>{:else}{part.text}{/if}{/each}</span>
        {/if}
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
      <Avatar handle={u.handle} name={u.displayName ?? u.handle} size={40} v={u.avatarUpdatedAt} />
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
  {@render filterBar()}
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
  {@render filterBar()}
  {#if scope === 'all'}
    {#if res.feeds.rows.length}
      <section class="group">
        <h2>Feeds <Badge>{res.feeds.total.toLocaleString()}</Badge>{#if res.feeds.total > res.feeds.rows.length}<button class="link all" onclick={() => setScope('feeds')}>See all</button>{/if}</h2>
        <ul class="list">{#each res.feeds.rows as f (f.id)}{@render feedRow(f, f)}{/each}</ul>
      </section>
    {/if}
    {#if res.collections.rows.length}
      <section class="group">
        <h2>Collections <Badge>{res.collections.total.toLocaleString()}</Badge>{#if res.collections.total > res.collections.rows.length}<button class="link all" onclick={() => setScope('collections')}>See all</button>{/if}</h2>
        <ul class="list">{#each res.collections.rows as c (c.id)}{@render colRow(c, c)}{/each}</ul>
      </section>
    {/if}
    {#if res.posts.rows.length}
      <section class="group">
        <h2>Posts <Badge>{res.posts.total.toLocaleString()}</Badge>{#if res.posts.total > res.posts.rows.length}<button class="link all" onclick={() => setScope('posts')}>See all</button>{/if}</h2>
        <ul class="list">{#each res.posts.rows as p (p.id)}{@render postRow(p)}{/each}</ul>
      </section>
    {/if}
    {#if res.people.rows.length}
      <section class="group">
        <h2>People <Badge>{res.people.total.toLocaleString()}</Badge>{#if res.people.total > res.people.rows.length}<button class="link all" onclick={() => setScope('people')}>See all</button>{/if}</h2>
        <ul class="list">{#each res.people.rows as u (u.handle)}{@render personRow(u, u)}{/each}</ul>
      </section>
    {/if}
  {:else}
    <section class="group">
      <h2>{SCOPES.find((s) => s.id === scope)?.label} <Badge>{(group?.total ?? 0).toLocaleString()}</Badge></h2>
      <ul class="list">
        {#if scope === 'feeds'}{#each rows as f (( f as SearchFeed).id)}{@render feedRow(f as SearchFeed, f as SearchFeed)}{/each}
        {:else if scope === 'collections'}{#each rows as c ((c as SearchCollection).id)}{@render colRow(c as SearchCollection, c as SearchCollection)}{/each}
        {:else if scope === 'posts'}{#each rows as p ((p as SearchPost).id)}{@render postRow(p as SearchPost)}{/each}
        {:else}{#each rows as u ((u as SearchPerson).handle)}{@render personRow(u as SearchPerson, u as SearchPerson)}{/each}{/if}
      </ul>
    </section>
  {/if}
{:else if browseAs === 'feeds'}
  <div class="browse">{@render filterBar()}<ul class="list">{#each feeds as f (f.id)}{@render feedRow(f, null)}{/each}</ul></div>
{:else if browseAs === 'collections'}
  <div class="browse">{@render filterBar()}<ul class="list">{#each cols as c (c.id)}{@render colRow(c, null)}{/each}</ul></div>
{:else}
  <div class="browse">{@render filterBar()}<ul class="list">{#each users as u (u.handle)}{@render personRow(u, null)}{/each}</ul></div>
{/if}

{#if loading}<p class="status">Loading…</p>{/if}
<div bind:this={sentinel} aria-hidden="true"></div>

<style>
  .top { margin-bottom: var(--space-3); }
  .titlerow { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); }
  h1 { font-family: var(--font-headings); font-size: calc(var(--text-2xl) * var(--size-headings)); margin: 0; min-width: 0; }
  /* text-wrap: pretty keeps a lone last word from stranding on its own line. */
  /* 2px is an optical nudge under the title, not a spacing step. */
  .sub { margin: 2px 0 0; color: var(--text-3); font-size: calc(var(--text-sm) * var(--size-app)); max-width: 62ch; text-wrap: pretty; }
  /* On a phone the subtitle drops its "all in one search" tail to stay one tidy line. */
  @media (max-width: 560px) { .sub .tail { display: none; } }
  .pane { margin-bottom: var(--space-2); }
  .head { margin-bottom: var(--space-5); }
  .pane :global(.scopes) { margin-bottom: var(--space-1); }
  h2 { font-family: var(--font-headings); font-size: calc(var(--text-xl) * var(--size-headings)); margin: 0; display: flex; align-items: baseline; gap: var(--space-2); }
  /* The per-view explainer: the caption above the filters, saying what this
     view is before its controls. A small accent-tinted icon sets it apart from
     the plain text below; the icon's left edge lines up with the filter labels. */
  /* Icon flows inline with the text so it always rides beside the first word —
     centered together, and never pinned to the edge when the text fills the line. */
  .blurb { margin: var(--space-2) 0 var(--space-4); color: var(--accent); font-size: calc(var(--text-sm) * var(--size-app)); text-align: center; text-wrap: pretty; }
  .blurb span { font-weight: 600; }
  .blurb-i { display: inline-block; vertical-align: -3px; margin-right: var(--space-2); color: var(--accent); }
  /* Browsing, the filters and list are one card; the caption leads it, inset to
     match the card's side padding. */
  .browse .blurb { margin: 0; padding: var(--space-5) var(--space-3) var(--space-2); }
  .group { margin-bottom: var(--space-5); }
  .group h2 { margin-bottom: var(--space-2); }
  /* Beats .link’s inherited size below: “See all” is a small action, not part of the heading. */
  h2 .all { margin-left: auto; font-family: var(--font); font-size: calc(var(--text-sm) * var(--size-app)); }
  .filters { display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-4); align-items: center; margin-bottom: var(--space-1); }
  /* Each filter reads as one line — its name, then the dropdown beside it —
     instead of the stack a labelled field normally makes. */
  .filters :global(.filter) { flex-direction: row; align-items: center; gap: var(--space-1); }
  .filters :global(.filter) > :global(label) { white-space: nowrap; font-weight: 400; }
  /* Narrow screens: the filters stack full-width into a tidy little form
     instead of wrapping into an orphaned control. */
  @media (max-width: 600px) {
    .filters { flex-direction: column; align-items: stretch; }
    .filters :global(.filter) { flex-direction: column; align-items: stretch; }
  }
  .list { list-style: none; margin: 0; padding: 0; background: var(--surface); border-radius: var(--radius); box-shadow: var(--shadow); overflow: hidden; }
  /* Browse: the filters are the list card's header, so the two read as one unit. */
  .browse { background: var(--surface); border-radius: var(--radius); box-shadow: var(--shadow); overflow: hidden; }
  .browse .filters { margin: 0; padding: var(--space-3) var(--space-3) var(--space-1); }
  .browse .list { background: none; box-shadow: none; border-radius: 0; }
  li { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--space-4) var(--space-3) var(--space-3); border-top: 1px solid var(--line); flex-wrap: wrap; }
  /* On a phone the Follow control would squeeze the description into a column
     four words wide, so it drops to its own line and the text gets the row. */
  @media (max-width: 560px) {
    li > :global(.row) { flex-basis: 100%; }
    li > :global(.split) { margin-left: auto; }
  }
  li:first-child { border-top: 0; }
  .row { flex: 1; min-width: 0; display: flex; align-items: center; gap: var(--space-3); }
  .meta { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .title { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .handle { font-weight: 400; color: var(--text-3); font-size: calc(var(--text-sm) * var(--size-app)); margin-left: var(--space-1); }
  /* Wraps rather than truncates: every part of it is a fact someone is deciding on.
     --text-2, not --text-3, because these facts are read, and --text-3 falls short
     of readable contrast in most themes. The gap sets it apart from the
     description above now that both share a color. */
  .sub2 { font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); margin-top: var(--space-1); }
  .desc { font-size: calc(var(--text-sm) * var(--size-app)); /* The 2px and 3px here are optical nudges around the description, not spacing steps. */ color: var(--text-2); margin: 2px 0 3px; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  /* 1px around a highlighted word is optical: the tint hugs the letters. */
  .desc mark { background: color-mix(in srgb, var(--accent) 28%, transparent); color: inherit; border-radius: var(--radius-xs); padding: 0 1px; }
  /* The line about your search: for a feed, how often it mentions your words
     over the last 30 days; for a collection, how many of its feeds do. The gap
     above keeps it clear of the description; 1px below is an optical nudge. */
  .why { font-size: calc(var(--text-sm) * var(--size-app)); color: var(--accent); margin: var(--space-2) 0 1px; }
  .why strong { font-weight: 700; }
  /* When the line has to wrap, "(latest 13h ago)" moves down whole instead of
     splitting inside the brackets. */
  .nowrap { white-space: nowrap; }
  .who { color: var(--text-2); font-weight: 600; }
  /* Each line's color says what it is about: dark is the feed (its name and these
     facts), grey is the feed describing itself, green is your search. The facts sit
     tight under the name, like a byline, and the description keeps its distance
     below. The -2px is optical: it takes back some of the empty space above and
     below each line of text, so the two lines read as a pair. */
  .sub2.byline { margin-top: -2px; color: var(--text); }
  .byline + .desc { margin-top: var(--space-2); }
  .net-n { color: var(--accent); font-weight: 600; }
  .bad { color: var(--danger); }
  .stack { display: inline-flex; flex: none; width: 40px; height: 40px; position: relative; }
  /* The overlapped avatars are placed, not spaced: 9px centers them in the 40px box and steps each one across. */
  .stack :global(> *) { position: absolute; top: 9px; }
  .stack :global(> :nth-child(1)) { left: 0; z-index: 3; }
  .stack :global(> :nth-child(2)) { left: 9px; z-index: 2; }
  .stack :global(> :nth-child(3)) { left: 18px; z-index: 1; }
  .chev { color: var(--text-3); font-size: calc(var(--text-xl) * var(--size-app)); }
  .follow, .save { flex: none; padding: var(--space-2) var(--space-4); border-radius: var(--radius-pill); border: 1px solid var(--accent); color: var(--accent); background: var(--surface); font-size: calc(var(--text-sm) * var(--size-app)); font-weight: 600; }
  .follow.on, .save.on { background: color-mix(in srgb, var(--accent) 14%, transparent); border-color: transparent; }
  .follow:disabled, .save:disabled { opacity: 0.6; }
  .status { text-align: center; color: var(--text-3); font-size: calc(var(--text-sm) * var(--size-app)); padding: var(--space-4) 0; margin: 0; }
  .status.error { color: var(--danger); }
  .empty { text-align: center; color: var(--text-2); padding: calc(var(--space-6) + var(--space-1)) var(--space-4); font-size: calc(var(--text-base) * var(--size-app)); }
  .empty p { margin: 0 auto; max-width: 480px; }
  .link { color: var(--accent); font-weight: 600; font-size: inherit; }
</style>
