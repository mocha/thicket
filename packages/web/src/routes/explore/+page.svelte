<script lang="ts">
  import Card from '$lib/components/Card.svelte';
  import Dot from '$lib/components/Dot.svelte';
  import Button from '$lib/components/Button.svelte';
  import { onDestroy, onMount } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import {
    api, exploreApi, searchApi, collectionHref, profilesApi,
    type Feed, type ExploreCollection, type ExploreUser,
    type SearchResults, type SearchScope, type SearchFeed, type SearchCollection, type SearchPost, type SearchPerson,
    DEFAULT_SCOPE, scopeFrom
  } from '$lib/api';
  import { longAgo } from '$lib/time';
  import { fence, latestShort, mentionRate, plural } from '$lib/words';
  import { session } from '$lib/session.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import AddFeedButton from '$lib/components/AddFeedButton.svelte';
  import Field from '$lib/components/Field.svelte';
  import Input from '$lib/components/Input.svelte';
  import Select from '$lib/components/Select.svelte';
  import Sheet from '$lib/components/Sheet.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import FiltersBox from '$lib/components/FiltersBox.svelte';
  import ItemCard from '$lib/components/ItemCard.svelte';
  import Marked from '$lib/components/Marked.svelte';
  import FeedRow from '$lib/components/FeedRow.svelte';
  import PersonRow from '$lib/components/PersonRow.svelte';
  import CollectionRow from '$lib/components/CollectionRow.svelte';
  import Tabs from '$lib/components/Tabs.svelte';
  import TabBlurb from '$lib/components/TabBlurb.svelte';
  import Badge from '$lib/components/Badge.svelte';
  import { showToast } from '$lib/toast.svelte';
  import { recall, keepOnLeave } from '$lib/listmemory';

  /**
   * Explore is one search box and four tabs: Posts, Feeds, Collections,
   * People. The tab is what you are searching for; a search runs for that tab
   * alone, when you press Enter or Search, never as you type.
   *
   * It used to search all four at once on every keystroke, so each tab could
   * show a count. On production that was eight database queries per keystroke,
   * and a few people typing at once took the whole service down (2026-10-11).
   * Now: one query per search, sent when asked for. Switching tabs with a
   * search in place sends it for the new tab; anything still on its way for
   * the old tab, or for an older search, is cancelled, in the database too.
   *
   * Feeds and collections are still found through what their posts say (no
   * feed is named "Mercedes", though plenty write about it): /api/search
   * builds them from the matching posts.
   *
   * With nothing typed each tab is a browse list: the newest posts on the
   * instance (where Explore opens), the feed index, public collections, people.
   * Everything lives in the URL (?q=, ?scope=, filters) so any view is a link.
   */
  const SCOPES: { id: SearchScope; label: string }[] = [
    { id: 'posts', label: 'Posts' },
    { id: 'feeds', label: 'Feeds' },
    { id: 'collections', label: 'Collections' },
    { id: 'people', label: 'People' }
  ];
  /**
   * One line under the tabs saying what the selected tab shows. Fixed spot, one
   * per scope, on every view — the tabs pick the view, this says what it is.
   */
  const SCOPE_BLURB: Record<SearchScope, string> = {
    feeds: 'Sites that publish a feed. Follow one and you’ll see every new post it publishes.',
    collections: 'Topical sets of feeds people share, so you can follow along.',
    posts: 'Individual posts from across every feed on thicket.',
    people: 'Public profiles you can browse and follow.'
  };
  const q = $derived((page.url.searchParams.get('q') ?? '').trim());
  const scope = $derived(scopeFrom(page.url.searchParams.get('scope')));
  const searching = $derived(q.length > 0);
  /**
   * Posts always load through /api/search: with words, a search; without, the
   * newest posts. The other tabs have their own browse lists until you search.
   */
  const viaSearch = $derived(searching || scope === 'posts');
  const browseAs = $derived(scope === 'collections' ? 'collections' : scope === 'people' ? 'users' : 'feeds');

  /**
   * Every tab offers the same three filters, searching or not: Show (everyone,
   * or what the people you follow read), a time window, and an order. A tab
   * leaves a choice out only when it can't mean anything: "Best match" needs
   * words to match.
   */
  const narrowToNetwork = $derived(page.url.searchParams.get('by') === 'following');
  const since = $derived(page.url.searchParams.get('since'));
  /** What the time window is a window on, per tab: when a post was published, a feed or collection added, a person joined. */
  const WHEN: Record<SearchScope, string> = { posts: 'Posted', feeds: 'Added', collections: 'Added', people: 'Joined' };
  const ADDED: Record<string, string> = { '': 'Any time', '24h': 'Past 24 hours', week: 'Past week', month: 'Past month', year: 'Past year' };

  /** A long search would stretch the dropdown, which is as wide as its longest choice. */
  const term = $derived(q.length > 18 ? 'this search' : `“${q}”`);
  type Order = { id: string; label: string };
  /**
   * The orders on offer for this tab, searching or not; the first is the
   * default. The ids are the API's (routes/search.ts, routes/explore.ts,
   * routes/feeds.ts). Nothing sorts people by followers: who follows whom is
   * private (issue #191).
   */
  const orders = $derived.by<Order[]>(() => {
    if (scope === 'posts') return [
      { id: 'newest', label: 'Newest first' },
      ...(searching ? [{ id: 'relevance', label: 'Best match' }] : []),
      { id: 'bookmarked', label: 'Most bookmarked' },
      { id: 'noted', label: 'Most noted' }
    ];
    if (scope === 'feeds') return searching ? [
      { id: 'about', label: `Most mentions of ${term}` },
      { id: 'mentioned', label: `Most recent mention of ${term}` },
      { id: 'active', label: 'Number of posts (last 90d)' },
      { id: 'posted', label: 'Most recent post' }
    ] : [
      { id: 'popular', label: 'Most popular' },
      { id: 'recent', label: 'Most recent posts' },
      { id: 'posts', label: 'Most active' },
      { id: 'title', label: 'A to Z' },
      { id: 'added', label: 'Newest here' }
    ];
    if (scope === 'collections') return [
      ...(searching ? [{ id: 'relevance', label: 'Best match' }] : []),
      { id: 'feeds', label: 'Most feeds' },
      { id: 'newest', label: 'Newest here' },
      ...(searching ? [] : [{ id: 'name', label: 'A to Z' }])
    ];
    return [
      ...(searching ? [{ id: 'relevance', label: 'Best match' }] : []),
      { id: 'name', label: 'A to Z' },
      { id: 'newest', label: 'Newest to join' }
    ];
  });
  /**
   * The order chosen, from ?sort=; anything this tab doesn't offer is its
   * default. 'followers' is the old name for Feeds' 'popular'; saved links still land on it.
   */
  const sortId = $derived(((v) => (orders.some((o) => o.id === v) ? v! : orders[0].id))(
    page.url.searchParams.get('sort') === 'followers' ? 'popular' : page.url.searchParams.get('sort')
  ));
  const order = $derived(orders.find((o) => o.id === sortId) ?? orders[0]);
  function setSort(v: string) {
    setParams({ sort: v === orders[0].id ? null : v });
    api.event('explore_sort', { scope, sort: v, searching });
  }
  /** A Feeds search sorted by newest post: its rows show the date they're sorted by. */
  const sortsFeedsByPost = $derived(searching && scope === 'feeds' && sortId === 'posted');
  let followsAnyone = $state<boolean | null>(null);
  const feedsNetwork = $derived(narrowToNetwork ? '1' : null);

  function setParams(patch: Record<string, string | null>) {
    const p = new URLSearchParams(page.url.searchParams);
    for (const [k, v] of Object.entries(patch)) v ? p.set(k, v) : p.delete(k);
    void goto(`/explore${p.size ? `?${p}` : ''}`, { replaceState: true, keepFocus: true });
  }
  /**
   * A search in place goes with you: the new tab loads it straight away (the
   * load effect below). So do Show and the time window, which every tab has;
   * the order resets, since each tab has its own.
   */
  function setScope(s: SearchScope) {
    setParams({ scope: s === DEFAULT_SCOPE ? null : s, sort: null });
    api.event('explore_scope', { scope: s, searching });
  }

  /**
   * What is in the box. Typing changes only this; nothing is sent until Enter
   * or Search. A new search replaces ?q=, and the load that follows cancels
   * whatever the old one still had on its way.
   */
  let draft = $state('');
  let searchInput = $state<HTMLInputElement | null>(null);
  /**
   * Search again with the same words is a retry, not nothing: the last attempt
   * may have failed ("That took too long, try again"), and the address won't
   * change to set off a load, so the load is asked for directly. An empty box
   * submitted over a search clears it, as the X does.
   */
  function submitSearch(e: SubmitEvent) {
    e.preventDefault();
    const v = draft.trim();
    if (v === q) {
      if (v) loadedKey = undefined; // the load effect sees a new key and loads this view afresh
      return;
    }
    // Starting or ending a search drops ?sort=: a browse order and a search order are different lists.
    setParams(!!v === searching ? { q: v || null } : { q: v || null, sort: null });
  }
  function clearSearch() {
    draft = '';
    setParams({ q: null, sort: null });
    searchInput?.focus();
  }

  /* ---- search ---- */
  let res = $state<SearchResults | null>(null);
  /** The rows of the current tab's list, accumulated across pages. */
  let more = $state<(SearchFeed | SearchCollection | SearchPost | SearchPerson)[]>([]);
  let moreNext = $state<number | null>(null);
  /**
   * The scope `more` was loaded for. Switching tabs redraws the list before the
   * new search is even sent, and drawing feed rows as collections crashed the
   * page, so rows only show under the tab they came from.
   */
  let moreScope = $state<SearchScope | null>(null);
  const rows = $derived(moreScope === scope ? more : []);
  /** How long the current tab's list is: null for the newest posts, which aren't counted. */
  const total = $derived<number | null>(res && moreScope === scope ? ((res as Record<string, any>)[scope]?.total ?? null) : null);
  /** The count stopped at the search's cap (only ever Posts), so there are more than it says. */
  const capped = $derived<boolean>(res && moreScope === scope ? ((res as Record<string, any>)[scope]?.capped ?? false) : false);
  /* No counts on the tabs: only the tab you are on has been searched. */
  const scopeTabs = $derived(SCOPES.map((s) => ({ value: s.id, label: s.label })));

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
   *
   * A fresh load also cancels the one before it, so a request nobody will look
   * at stops at once, in the database as well (api/search cancels its query
   * when the browser drops the request). So does leaving the page.
   */
  let latestLoad = 0;
  let inFlight: AbortController | null = null;
  onDestroy(() => inFlight?.abort());
  /** Said to a screen reader when scrolling brings in more rows: "25 more loaded, 50 in all." The rows themselves aren't read out. */
  let loadedSaid = $state('');
  const shown = () => (viaSearch ? more.length : browseAs === 'feeds' ? feeds.length : browseAs === 'collections' ? cols.length : users.length);
  async function load<T>(reset: boolean, hasMore: boolean, request: (signal: AbortSignal) => Promise<T>, apply: (r: T) => void) {
    if (!reset && (loading || !hasMore)) return;
    if (reset) inFlight?.abort();
    const ac = new AbortController();
    inFlight = ac;
    const key = loadedKey;
    const id = ++latestLoad;
    const isCurrent = () => key === loadedKey && id === latestLoad;
    loading = true; error = null;
    try {
      const r = await request(ac.signal);
      if (isCurrent()) {
        const before = shown();
        apply(r);
        const now = shown();
        loadedSaid = !reset && now > before ? `${(now - before).toLocaleString()} more loaded, ${now.toLocaleString()} in all.` : '';
      }
    } catch (e) {
      // A cancelled request was replaced on purpose; it is not an error to show.
      if (isCurrent() && !ac.signal.aborted) error = e instanceof Error ? e.message : String(e);
    } finally { if (isCurrent()) loading = false; }
  }

  function loadSearch(reset = false) {
    const s = scope;
    return load(reset, moreNext !== null,
      (signal) => searchApi.run({ q, scope: s, limit: 25, offset: reset ? 0 : moreNext ?? 0, network: feedsNetwork, since, sort: sortId }, signal),
      (r) => {
        const got = (r as Record<string, any>)[s] as { rows: any[]; nextOffset: number | null };
        res = r;
        // The newest posts move while you scroll; a post that slid onto the next page shows once.
        const seen = new Set(reset ? [] : more.map((x) => ('id' in x ? x.id : x.handle)));
        const fresh = got.rows.filter((x) => !seen.has('id' in x ? x.id : x.handle));
        more = reset ? got.rows : [...more, ...fresh];
        moreNext = got.nextOffset;
        moreScope = s;
      });
  }

  /* ---- browse: feeds ---- */
  let feeds = $state<Feed[]>([]);
  let feedsTotal = $state(0);
  let feedsAll = $state(0);
  let feedsNext = $state<number | null>(null);
  function loadFeeds(reset = false) {
    return load(reset, feedsNext !== null,
      () => api.feeds({ network: feedsNetwork, since, sort: sortId, limit: 50, offset: reset ? 0 : feedsNext ?? 0 }),
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
      () => exploreApi.collections({ network: narrowToNetwork, since, sort: sortId, limit: 30, offset: reset ? 0 : colsNext ?? 0 }),
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
      () => exploreApi.users({ network: narrowToNetwork, since, sort: sortId, limit: 30, offset: reset ? 0 : usersNext ?? 0 }),
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

  /* ---- shared ---- */
  let loading = $state(false);
  let error = $state<string | null>(null);
  let sentinel = $state<HTMLElement | null>(null);
  let loadedKey = $state<string | undefined>(undefined);

  /**
   * Back or Forward to Explore: every list as it was left, so the scroll lands
   * where you were. The row you opened is the one thing likely to have changed
   * while you were away (you followed that feed or person), so it alone is
   * looked up again.
   */
  type Opened = { feed: number } | { person: string };
  let opened: Opened | null = null;
  const back = recall<{
    res: SearchResults | null; more: typeof more; moreNext: number | null; moreScope: SearchScope | null;
    feeds: Feed[]; feedsTotal: number; feedsAll: number; feedsNext: number | null;
    cols: ExploreCollection[]; colsTotal: number; colsNext: number | null;
    users: ExploreUser[]; usersTotal: number; usersNext: number | null;
    followsAnyone: boolean | null; loadedKey: string | undefined; opened: Opened | null;
  }>('explore');
  function restore(b: NonNullable<typeof back>) {
    ({ res, more, moreNext, moreScope, feeds, feedsTotal, feedsAll, feedsNext, cols, colsTotal, colsNext, users, usersTotal, usersNext, followsAnyone, loadedKey } = b);
    if (b.opened) void refreshOpened(b.opened);
  }
  if (back) restore(back);
  keepOnLeave(() => 'explore', () => ({
    res, more, moreNext, moreScope, feeds, feedsTotal, feedsAll, feedsNext, cols, colsTotal, colsNext, users, usersTotal, usersNext, followsAnyone, loadedKey, opened
  }));

  async function refreshOpened(o: Opened) {
    try {
      if ('feed' in o) {
        const rows = [...feeds, ...(moreScope === 'feeds' ? more : [])] as (Feed | SearchFeed)[];
        const hits = rows.filter((f) => f.id === o.feed);
        if (hits.length) { const u = await api.feed(o.feed); for (const f of hits) Object.assign(f, u); }
      } else {
        const rows = [...users, ...(moreScope === 'people' ? more : [])] as (ExploreUser | SearchPerson)[];
        const hits = rows.filter((u) => u.handle === o.person);
        if (hits.length) { const p = await profilesApi.get(o.person); if (!p.private) for (const u of hits) u.isFollowing = p.people.isFollowing; }
      }
    } catch { /* the row keeps what it showed before; the next fresh visit corrects it */ }
  }

  onMount(() => {
    api.event('feeds_view'); draft = q;
    if (back && back.followsAnyone !== null) return;
    if (session.user) profilesApi.get(session.user.handle).then((p) => { followsAnyone = !p.private && p.people.follows > 0; }).catch(() => (followsAnyone = false));
    else followsAnyone = false;
  });

  function loadMore() {
    if (viaSearch) void loadSearch();
    else if (browseAs === 'feeds') void loadFeeds();
    else if (browseAs === 'collections') void loadCols();
    else void loadUsers();
  }

  $effect(() => {
    if (followsAnyone === null) return; // wait until we know the default
    const key = `${q}|${scope}|${feedsNetwork}|${since}|${sortId}`;
    if (loadedKey === key) return;
    loadedKey = key;
    if (viaSearch) { res = null; more = []; moreNext = null; void loadSearch(true); }
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
    !loading && (viaSearch
      ? res !== null && moreScope === scope && more.length === 0
      : (browseAs === 'feeds' ? feeds.length : browseAs === 'collections' ? cols.length : users.length) === 0)
  );
  const scopeLabel = $derived(SCOPES.find((s) => s.id === scope)?.label ?? '');

  /* Three filters laid out push the list down or crowd the card, so on every
     tab, at every width, they fold into one box that names what's chosen and
     opens the dropdowns in a Sheet. Each part reads as a phrase on its own:
     "Show everyone · Added any time · Most popular". */
  const filterSummary = $derived([
    narrowToNetwork ? 'Show people I follow' : 'Show everyone',
    `${WHEN[scope]} ${(ADDED[since ?? ''] ?? 'Any time').toLowerCase()}`,
    order.label
  ]);
  let filtersDialog = $state<HTMLDialogElement | null>(null);

  /**
   * What a screen reader is told when a search comes back: how many results,
   * and of what. The results redraw as you type, and without this nothing says
   * so. Empty while a search is still on its way, so only the answer is read.
   */
  const KINDS: Record<SearchScope, [string, string]> = { feeds: ['feed', 'feeds'], collections: ['collection', 'collections'], posts: ['post', 'posts'], people: ['person', 'people'] };
  const said = $derived.by(() => {
    if (!searching || loading || !res || total === null) return '';
    return total === 0 ? `No ${KINDS[scope][1]} match “${q}”.` : `${plural(total, ...KINDS[scope])} for “${q}”.`;
  });
</script>

<svelte:head><title>{searching ? `${q} · Explore` : 'Explore'} · thicket</title></svelte:head>

<PageHeader name="Explore">
  {#snippet description()}Find feeds, collections, posts, and people.{/snippet}
  {#snippet actions()}<AddFeedButton via="explore" bottomBarOnly />{/snippet}
</PageHeader>

<section class="pane">
  <!-- Nothing is searched until Enter or Search: typing only edits the box. -->
  <form class="head" role="search" onsubmit={submitSearch}>
    <Field label="Search" hideLabel>
      {#snippet children({ id })}
        <Input
          {id}
          enterkeyhint="search"
          bind:element={searchInput}
          variant="search"
          size="lg"
          value={draft}
          oninput={(e) => (draft = e.currentTarget.value)}
          onclear={clearSearch}
          placeholder="Search {SCOPES.find((s) => s.id === scope)?.label.toLowerCase()}"
        >
          {#snippet trailing()}<Button type="submit" variant="primary" disabled={!draft.trim() && !q}>Search</Button>{/snippet}
        </Input>
      {/snippet}
    </Field>
  </form>

  <Tabs
    class="scopes"
    tabs={scopeTabs}
    value={scope}
    onchange={(v) => setScope(v as SearchScope)}
    label="What to search"
    panel="explore-results"
    fill
  />
  <p class="visually-hidden" role="status">{said}</p>
  <p class="visually-hidden" role="status">{loadedSaid}</p>
</section>

<!-- The filters that act on a browse list. Rendered as the list card's header
     when browsing (attached to what they control), and as a plain bar above the
     stacked result cards when searching. -->
{#snippet scopeIcon(s: SearchScope)}
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    {#if s === 'feeds'}<path d="M4 11a9 9 0 0 1 9 9" /><path d="M4 4a16 16 0 0 1 16 16" /><circle cx="5" cy="19" r="1" />
    {:else if s === 'collections'}<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.57 3.9a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" /><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65" /><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65" />
    {:else if s === 'posts'}<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /><path d="M16 13H8" /><path d="M16 17H8" /><path d="M10 9H8" />
    {:else if s === 'people'}<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
    {/if}
  </svg>
{/snippet}

{#snippet filterFields()}
    <Select
      class="filter"
      label="Show"
      size="sm"
      title={followsAnyone === false ? 'Follow someone first' : ''}
      value={narrowToNetwork ? 'following' : ''}
      options={[
        { value: '', label: 'Everyone' },
        { value: 'following', label: 'People I follow', disabled: followsAnyone === false }
      ]}
      onchange={(e) => setParams({ by: e.currentTarget.value === 'following' ? 'following' : null })}
    />
    <Select
      class="filter"
      label={WHEN[scope]}
      size="sm"
      value={since ?? ''}
      options={Object.entries(ADDED).map(([value, label]) => ({ value, label }))}
      onchange={(e) => setParams({ since: e.currentTarget.value || null })}
    />
    <Select
      class="filter"
      label="Sort"
      size="sm"
      value={sortId}
      options={orders.map((o) => ({ value: o.id, label: o.label }))}
      onchange={(e) => setSort(e.currentTarget.value)}
    />
{/snippet}

<!-- How many a search found, under the filters. A Posts search stops counting at a cap (HIT_CAP in routes/search.ts), and a count that reached it says "or more": "4,000+". -->
{#snippet countLine()}
  {#if searching && total !== null}
    <p class="count">{total.toLocaleString()}{capped ? '+' : ''} {total === 1 ? KINDS[scope][0] : KINDS[scope][1]} {scope === 'posts' ? (total === 1 ? 'mentions' : 'mention') : (total === 1 ? 'matches' : 'match')} “{q}”</p>
  {/if}
{/snippet}

{#snippet filterBar()}
  <TabBlurb class="blurb" text={SCOPE_BLURB[scope]}>{#snippet icon()}{@render scopeIcon(scope)}{/snippet}</TabBlurb>
  <FiltersBox class="filters-row" summary={filterSummary} onclick={() => filtersDialog?.showModal()} />
{/snippet}

<!-- Rows. Each kind knows how to show its own evidence; see lib/words.ts. -->
<!-- The searched words inside a row's facts, highlighted as on a post. -->
{#snippet searched()}<Marked text={fence(q)} />{/snippet}

<!-- A row's search fact is passed only when there is one: a row given an empty
     one would draw the dot before it, or lose its own count. -->
{#snippet feedRow(f: SearchFeed | Feed, ev: SearchFeed | null)}
  {#snippet why()}
    {#if ev && ev.matchesLast30d > 0}
      <span aria-hidden="true">~</span><span class="visually-hidden">about </span>{mentionRate(ev.matchesLast30d)} {@render searched()}{#if ev.lastMatchAt}{' '}<span class="nowrap">({latestShort(ev.lastMatchAt)})</span>{/if}
    {:else if ev && ev.lastMatchAt}
      Last mentioned {@render searched()} {longAgo(ev.lastMatchAt)}
    {:else}
      Name matches, but no posts mention {@render searched()}
    {/if}
  {/snippet}
  <!-- A search row shows what the search found, and the fact its order is
       sorted by when that's something else: how much it posts, or its newest post. -->
  <FeedRow
    feed={f}
    failing={f.consecutiveFailures >= 3}
    postsLast30d={!ev || sortId === 'active' ? f.postsLast30d : undefined}
    network={!ev && feedsNetwork ? ((f as Feed).networkFollowers ?? 0) : 0}
    latest={!ev || sortsFeedsByPost}
    onopen={() => (opened = { feed: f.id })}
    onchange={() => void api.feed(f.id).then((u) => Object.assign(f, u))}
    children={ev ? why : undefined}
  />
{/snippet}

{#snippet colRow(c: ExploreCollection | SearchCollection, ev: SearchCollection | null)}
  {#snippet why()}
    {#if ev && ev.matches > 0}
      {ev.matchingFeeds.toLocaleString()} of {plural(c.feedCount, 'feed')} {ev.matchingFeeds === 1 ? 'has' : 'have'} posted about {@render searched()}{#if ev.lastMatchAt}{'\u00a0'}<Dot />{' '}most recent {longAgo(ev.lastMatchAt)}{/if}
    {:else}
      {plural(c.feedCount, 'feed')}{'\u00a0'}<Dot />{' '}Matches the name
    {/if}
  {/snippet}
  <!-- The same pills as a profile's Collections: whose it is shows beside the name, not only in the byline. -->
  {#snippet badges()}{#if ev?.isMine}<Badge>Yours</Badge>{:else if ev?.copiedByMe}<Badge>Copied</Badge>{/if}{/snippet}
  <CollectionRow href={collectionHref(c.handle, c.slug)} name={c.name} description={c.description} feedCount={c.feedCount} owner={c.displayName ?? `@${c.handle}`} sample={c.sample} {badges} children={ev ? why : undefined} />
{/snippet}

{#snippet personRow(u: ExploreUser | SearchPerson, ev: SearchPerson | null)}
  {#snippet why()}
    {#if ev?.notesMatch}{plural(ev.notesMatch, 'note')} about {@render searched()}{/if}{#if ev?.notesMatch && ev?.marksMatch}{'\u00a0'}<Dot />{' '}{/if}{#if ev?.marksMatch}{plural(ev.marksMatch, 'bookmark')} about {@render searched()}{/if}
  {/snippet}
  <PersonRow person={u} feeds={u.feeds} collections={u.collections} following={u.isFollowing} me={ev?.isMe} busy={followBusy === u.handle} onfollow={() => toggleFollow(u)} onopen={() => (opened = { person: u.handle })}
    children={ev && ev.notesMatch + ev.marksMatch > 0 ? why : undefined} />
{/snippet}

{#snippet emptyMessage()}
  <div class="empty">
    {#if since}
      <!-- A time window can empty any list, searched or not, so it says so before anything else. -->
      <p>Nothing {scope === 'posts' ? 'was posted' : scope === 'people' ? 'joined' : 'was added'}{searching ? ` that matches “${q}”` : ''} in that time. <button class="link" onclick={() => setParams({ since: null })}>Show any time</button>.</p>
    {:else if searching}
      <p>No {scopeLabel.toLowerCase()} match “{q}”. {#if scope !== 'posts'}<button class="link" onclick={() => setScope('posts')}>Search posts instead</button>, or try{:else}Try{/if} another tab above.</p>
    {:else if scope === 'posts'}
      {#if feedsNetwork}<p>Nothing new from the feeds the people you follow read. <button class="link" onclick={() => setParams({ by: null })}>Show everyone’s</button>.</p>
      {:else if sortId === 'bookmarked' || sortId === 'noted'}<p>Nobody has {sortId === 'noted' ? 'written a note on' : 'bookmarked'} a post yet. <button class="link" onclick={() => setSort('newest')}>Show the newest posts</button>.</p>
      {:else}<p>No posts yet. Follow a feed and its posts will turn up here.</p>{/if}
    {:else if browseAs === 'feeds'}
      {#if feedsNetwork}<p>The people you follow haven’t followed anything you don’t already. <button class="link" onclick={() => setParams({ by: null })}>Show the whole index</button>.</p>
      {:else}<p>Nobody has added a feed yet. Be the first: press <strong>Add a new feed</strong> and paste a site’s address.</p>{/if}
    {:else if browseAs === 'collections'}
      {#if narrowToNetwork}<p>The people you follow haven’t shared any collections yet. <button class="link" onclick={() => setParams({ by: null })}>Show everyone’s</button>.</p>
      {:else}<p>No one has shared a public collection yet. Yours could be first: open a collection, Manage, and set it to Public.</p>{/if}
    {:else if narrowToNetwork}
      <p>You don’t follow anyone yet. <button class="link" onclick={() => setParams({ by: null })}>Show everyone</button>.</p>
    {:else}
      <p>No other public profiles here yet.</p>
    {/if}
  </div>
{/snippet}

<!-- What the tabs above switch between. -->
<div id="explore-results" role="tabpanel" aria-label={scopeLabel}>
{#if error}
  <p class="status error" role="alert">Couldn’t load: {error}</p>
{:else if nothing}
  <!-- The message takes the rows' place inside the list card, so a filter that empties the list leaves the filters where they were. -->
  <Card kind="list" as="div" class="browse">{@render filterBar()}{@render emptyMessage()}</Card>
{:else if viaSearch && scope === 'posts'}
  <!-- Posts are article cards, the same as in a feed, so they follow the list card's top instead of sitting in it. -->
  <Card kind="list" as="div" class="browse">{@render filterBar()}{@render countLine()}</Card>
  {#if res}<div class="posts">
    {#each rows as p ((p as SearchPost).id)}
      {@const post = p as SearchPost}
      <ItemCard item={post} marks={searching ? { title: post.titleMarked, summary: post.snippet } : null} />
    {/each}
  </div>{/if}
{:else if viaSearch}
  <!-- Its filters show at once; the rows arrive under them, in the same card as browsing. -->
  <Card kind="list" as="div" class="browse">
    {@render filterBar()}{@render countLine()}
    {#if res}<ul class="list-rows">
      {#if scope === 'feeds'}{#each rows as f ((f as SearchFeed).id)}{@render feedRow(f as SearchFeed, f as SearchFeed)}{/each}
      {:else if scope === 'collections'}{#each rows as c ((c as SearchCollection).id)}{@render colRow(c as SearchCollection, c as SearchCollection)}{/each}
      {:else}{#each rows as u ((u as SearchPerson).handle)}{@render personRow(u as SearchPerson, u as SearchPerson)}{/each}{/if}
    </ul>{/if}
  </Card>
{:else if browseAs === 'feeds'}
  <Card kind="list" as="div" class="browse">{@render filterBar()}<ul class="list-rows">{#each feeds as f (f.id)}{@render feedRow(f, null)}{/each}</ul></Card>
{:else if browseAs === 'collections'}
  <Card kind="list" as="div" class="browse">{@render filterBar()}<ul class="list-rows">{#each cols as c (c.id)}{@render colRow(c, null)}{/each}</ul></Card>
{:else}
  <Card kind="list" as="div" class="browse">{@render filterBar()}<ul class="list-rows">{#each users as u (u.handle)}{@render personRow(u, null)}{/each}</ul></Card>
{/if}

</div>

{#if loading}<p class="status">Loading…</p>{/if}
<div bind:this={sentinel} aria-hidden="true"></div>

<Sheet title="Filters" lede="Choose what this list shows and in what order." bind:dialog={filtersDialog}>
  <div class="sheet-rows">{@render filterFields()}</div>
</Sheet>


<style>
  .pane { margin-bottom: var(--space-2); }
  .head { margin-bottom: var(--space-5); }
  .pane :global(.scopes) { margin-bottom: var(--space-1); }
  /* The per-view explainer: the caption above the filters, saying what this
     view is before its controls. A small accent-tinted icon sets it apart from
     the plain text below; the icon's left edge lines up with the filter labels. */
  /* Icon flows inline with the text so it always rides beside the first word —
     centered together, and never pinned to the edge when the text fills the line. */
  /* Browsing, the filters and list are one card; the caption leads it, inset to
     match the card's side padding. */
  :global(.browse) :global(.blurb) { margin: 0; padding: var(--space-5) var(--card-pad) var(--space-2); }
  /* How many a search found: a quiet line between the filters and the first result. */
  .count { margin: 0; padding: var(--space-1) var(--card-pad) var(--space-3); color: var(--text-2); font-size: calc(var(--text-sm) * var(--size-app)); }
  /* Article cards under the list card's top, spaced as in a feed. */
  .posts { display: flex; flex-direction: column; gap: var(--space-3); margin-top: var(--space-3); }
  /* Inside the list card the filters box keeps the card's side padding around it. Two classes, so it wins over the box's own margin whatever order the styles load in. */
  :global(.browse .filters-box.filters-row) { width: calc(100% - var(--card-pad) * 2); margin: var(--space-3) var(--card-pad) var(--space-2); }
  /* When the line has to wrap, "(latest 13h ago)" moves down whole instead of
     splitting inside the brackets. */
  .nowrap { white-space: nowrap; }
  .status { text-align: center; color: var(--text-2); font-size: calc(var(--text-sm) * var(--size-app)); padding: var(--space-4) 0; margin: 0; }
  .status.error { color: var(--danger); }
  .empty { text-align: center; color: var(--text-2); padding: calc(var(--space-6) + var(--space-1)) var(--space-4); font-size: calc(var(--text-base) * var(--size-app)); }
  .empty p { margin: 0 auto; max-width: 480px; }
  .link { color: var(--accent); font-weight: 600; font-size: inherit; }
</style>
