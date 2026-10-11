<script lang="ts">
  import Card from '$lib/components/Card.svelte';
  import Dot from '$lib/components/Dot.svelte';
  import Button from '$lib/components/Button.svelte';
  import { onDestroy, onMount } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import {
    api, bookmarksApi, exploreApi, searchApi, feedHref, collectionHref, profileHref, profilesApi,
    type Feed, type ExploreCollection, type ExploreUser,
    type SearchResults, type SearchScope, type SearchFeed, type SearchCollection, type SearchPost, type SearchPerson,
    type FeedSearchSort, DEFAULT_FEED_SORT, feedSortFrom, DEFAULT_SCOPE, scopeFrom,
    type PostSearchSort, DEFAULT_POST_SORT, postSortFrom
  } from '$lib/api';
  import { feedOrigin, hostOf, longAgo, postRate, relativeTime, webHref } from '$lib/time';
  import { highlight, latestShort, mentionRate, plural } from '$lib/words';
  import { feedListName } from '$lib/feedname';
  import { session } from '$lib/session.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import FollowButton from '$lib/components/FollowButton.svelte';
  import AddFeedButton from '$lib/components/AddFeedButton.svelte';
  import Field from '$lib/components/Field.svelte';
  import Input from '$lib/components/Input.svelte';
  import Select from '$lib/components/Select.svelte';
  import Sheet from '$lib/components/Sheet.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import SourceIcon from '$lib/components/SourceIcon.svelte';
  import FeedPopover from '$lib/components/FeedPopover.svelte';
  import FollowControl from '$lib/components/FollowControl.svelte';
  import Avatar from '$lib/components/Avatar.svelte';
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
    posts: 'Individual posts from across every feed on thicket, newest first.',
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
   * One filter, off by default: absent shows the whole index, 'following'
   * narrows to what the people you follow read.
   */
  const narrowToNetwork = $derived(page.url.searchParams.get('by') === 'following');
  const since = $derived(page.url.searchParams.get('since'));
  /** `summary` is how the folded Filters box names the order, after "Show everyone · Added any time". */
  const sorts = [
    { id: 'popular', label: 'Popular', summary: 'Most popular' },
    { id: 'recent', label: 'Recent posts', summary: 'Most recent posts' },
    { id: 'posts', label: 'Most active', summary: 'Most active' },
    { id: 'title', label: 'A–Z', summary: 'A to Z' },
    { id: 'added', label: 'Newest here', summary: 'Newest here' }
  ];
  // 'followers' is the old name for 'popular'; saved links still land on it. ?sort= is also a
  // search's feed order (below), so a value that isn't a browse order is read as the default.
  const sort = $derived(((s) => (s === 'followers' ? 'popular' : sorts.some((x) => x.id === s) ? s : 'popular'))(page.url.searchParams.get('sort') ?? 'popular'));

  /**
   * The order of a search's Feeds list (issue 182). Searching, ?sort= means
   * this; anything it doesn't know is the default. Only the Feeds tab offers
   * it: Everything's short preview of feeds keeps the default.
   */
  const feedSort = $derived(feedSortFrom(page.url.searchParams.get('sort')));
  /** A long search would stretch the dropdown, which is as wide as its longest choice. */
  const term = $derived(q.length > 18 ? 'this search' : `“${q}”`);
  const feedSorts = $derived<{ id: FeedSearchSort; label: string; help: string }[]>([
    { id: 'about', label: `most mentions of ${term}`, help: `Feeds with the most posts mentioning “${q}” in the last 90 days come first. Feeds that only match by name come last.` },
    { id: 'mentioned', label: `most recent mention of ${term}`, help: `Feeds that mentioned “${q}” most recently come first. Feeds that only match by name come last.` },
    { id: 'active', label: 'number of posts (last 90d)', help: 'Feeds that posted the most in the last 90 days, about anything, come first.' },
    { id: 'posted', label: 'most recent post', help: 'Feeds with the newest posts, about anything, come first.' }
  ]);
  const feedSortHelp = $derived(feedSorts.find((s) => s.id === feedSort)?.help ?? '');
  const sortsFeeds = $derived(searching && scope === 'feeds');

  /** A Posts search's order. Newest first unless asked; with nothing typed it is always newest. */
  const postSort = $derived(postSortFrom(page.url.searchParams.get('sort')));
  const sortsPosts = $derived(searching && scope === 'posts');
  const postSorts: { id: PostSearchSort; label: string }[] = [
    { id: 'newest', label: 'Newest first' },
    { id: 'relevance', label: 'Best match' }
  ];
  function setPostSort(v: string) {
    const s = postSortFrom(v);
    setParams({ sort: s === DEFAULT_POST_SORT ? null : s });
    api.event('explore_post_sort', { sort: s });
  }
  function setFeedSort(v: string) {
    const s = feedSortFrom(v);
    setParams({ sort: s === DEFAULT_FEED_SORT ? null : s });
    api.event('explore_feed_sort', { sort: s });
  }
  let followsAnyone = $state<boolean | null>(null);
  const feedsNetwork = $derived(narrowToNetwork ? '1' : null);

  function setParams(patch: Record<string, string | null>) {
    const p = new URLSearchParams(page.url.searchParams);
    for (const [k, v] of Object.entries(patch)) v ? p.set(k, v) : p.delete(k);
    void goto(`/explore${p.size ? `?${p}` : ''}`, { replaceState: true, keepFocus: true });
  }
  /** A search in place goes with you: the new tab loads it straight away (the load effect below). */
  function setScope(s: SearchScope) {
    setParams({ scope: s === DEFAULT_SCOPE ? null : s, since: null, sort: null });
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
    const sort = s === 'feeds' ? feedSort : s === 'posts' ? postSort : undefined;
    return load(reset, moreNext !== null,
      (signal) => searchApi.run({ q, scope: s, limit: 25, offset: reset ? 0 : moreNext ?? 0, network: feedsNetwork, sort }, signal),
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
      if (p.bookmarkId) { await bookmarksApi.remove(p.bookmarkId); p.bookmarkId = null; showToast('Removed bookmark'); }
      else { const b = await bookmarksApi.saveItem(p.id); p.bookmarkId = b.id; api.event('bookmark_saved', { itemId: p.id, via: 'search' }); showToast('Bookmarked'); }
    } catch (e) { showToast(e instanceof Error ? e.message : String(e)); } finally { markBusy = null; }
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
  /** A post result's feed, its card open from the row's icon or feed name. */
  let source = $state<{ feedId: number; hasIcon: boolean; name: string } | null>(null);
  function openSource(p: SearchPost) {
    api.event('source_opened', { feedId: p.feedId, via: 'explore' });
    source = { feedId: p.feedId, hasIcon: p.hasIcon, name: p.feedTitle ?? hostOf(p.siteUrl) };
  }

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
    const key = `${q}|${scope}|${feedsNetwork}|${since}|${sort}|${sortsFeeds ? feedSort : ''}|${sortsPosts ? postSort : ''}`;
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

  /* Browsing feeds has three filters. Laid out, they push the list down or
     crowd the card, so at every width they fold into one box that names
     what's chosen and opens the same three dropdowns in a Sheet. */
  const ADDED: Record<string, string> = { '': 'Any time', '24h': 'Past 24 hours', week: 'Past week', month: 'Past month', year: 'Past year' };
  const threeFilters = $derived(!viaSearch && browseAs === 'feeds');
  /* Each part reads as a phrase on its own: "Show everyone · Added any time · Most popular". */
  const filterSummary = $derived([
    narrowToNetwork ? 'Show people I follow' : 'Show everyone',
    `Added ${(ADDED[since ?? ''] ?? 'Any time').toLowerCase()}`,
    sorts.find((x) => x.id === sort)?.summary ?? 'Most popular'
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
      disabled={browseAs === 'users'}
      options={[
        { value: '', label: 'Everyone' },
        { value: 'following', label: 'People I follow', disabled: followsAnyone === false }
      ]}
      onchange={(e) => setParams({ by: e.currentTarget.value === 'following' ? 'following' : null })}
    />
    {#if !viaSearch && browseAs === 'feeds'}
      <Select
        class="filter"
        label="Added"
        size="sm"
        value={since ?? ''}
        options={[
          ...Object.entries(ADDED).map(([value, label]) => ({ value, label }))
        ]}
        onchange={(e) => setParams({ since: e.currentTarget.value || null })}
      />
      <Select
        class="filter"
        label="Sort"
        size="sm"
        value={sort}
        options={sorts.map((s) => ({ value: s.id, label: s.label }))}
        onchange={(e) => setParams({ sort: e.currentTarget.value === 'popular' ? null : e.currentTarget.value })}
      />
    {/if}
    {#if sortsFeeds}
      <Select
        class="filter"
        label="Sort by"
        size="sm"
        value={feedSort}
        options={feedSorts.map((s) => ({ value: s.id, label: s.label }))}
        aria-describedby="feed-sort-help"
        onchange={(e) => setFeedSort(e.currentTarget.value)}
      />
    {/if}
    {#if sortsPosts}
      <Select
        class="filter"
        label="Sort by"
        size="sm"
        value={postSort}
        options={postSorts.map((s) => ({ value: s.id, label: s.label }))}
        onchange={(e) => setPostSort(e.currentTarget.value)}
      />
    {/if}
{/snippet}

{#snippet filterBar()}
  <TabBlurb class="blurb" text={SCOPE_BLURB[scope]}>{#snippet icon()}{@render scopeIcon(scope)}{/snippet}</TabBlurb>
  {#if threeFilters}
    <button type="button" class="filters-row" onclick={() => filtersDialog?.showModal()} aria-haspopup="dialog">
      <svg class="fr-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" /></svg>
      <span class="fr-text"><span class="fr-name">Filters</span><span class="fr-now">{#each filterSummary as part, i (i)}{#if i > 0}{' '}<Dot />{' '}{/if}<span class="fr-part">{part}</span>{/each}</span></span>
      <span class="fr-caret"><Icon name="caret" dir="down" size={20} /></span>
    </button>
  {:else}
    <div class="filters">{@render filterFields()}</div>
  {/if}
  <!-- What the chosen order means, said under the row rather than inside it so
       the filters stay one line. The dropdown points at it, so it is read out too. -->
  {#if sortsFeeds}<p class="sort-help" id="feed-sort-help">{feedSortHelp}</p>{/if}
{/snippet}

<!-- Rows. Each kind knows how to show its own evidence; see lib/words.ts. -->
{#snippet feedRow(f: SearchFeed | Feed, ev: SearchFeed | null)}
  <li>
    <a class="row tap" href={feedHref(f)} onclick={() => (opened = { feed: f.id })}>
      <SourceIcon feedId={f.id} hasIcon={f.hasIcon} name={f.title ?? hostOf(f.url)} size={40} />
      <div class="meta">
        <span class="title">{feedListName(f)}</span>
        <span class="sub2 byline">
          {feedOrigin(f)}
          {#if f.postsLast30d} <Dot /> publishes about {postRate(f.postsLast30d)}{/if}
          <!-- Sorted by newest post, a search row shows the date it is sorted by. -->
          {#if (!ev || (sortsFeeds && feedSort === 'posted')) && f.lastItemAt} <Dot /> latest {longAgo(f.lastItemAt)}{/if}
          {#if !ev && feedsNetwork && (f as Feed).networkFollowers} <Dot /> <span class="net-n">{(f as Feed).networkFollowers} {(f as Feed).networkFollowers === 1 ? 'person' : 'people'} you follow</span>{/if}
          {#if f.consecutiveFailures >= 3} <Dot /> <span class="bad">failing</span>{/if}
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
    <a class="row tap" href={collectionHref(c.handle, c.slug)}>
      <span class="stack" aria-hidden="true">
        {#each c.sample.slice(0, 3) as s (s.id)}<SourceIcon feedId={s.id} hasIcon={s.hasIcon} name={s.title ?? '?'} size={22} />{/each}
      </span>
      <div class="meta">
        <!-- The same pills as a profile's Collections: whose it is shows beside the name, not only in the byline. -->
        <span class="named"><span class="title">{c.name}</span>{#if ev?.isMine}<Badge class="own">Yours</Badge>{:else if ev?.copiedByMe}<Badge class="own">Copied</Badge>{/if}</span>
        {#if ev && ev.matches > 0}
          <span class="why">
            <strong>{plural(ev.matchingFeeds, 'feed')}</strong> in it {ev.matchingFeeds === 1 ? 'has' : 'have'} posted about “{q}”
            {#if ev.lastMatchAt} <Dot /> most recent {longAgo(ev.lastMatchAt)}{/if}
          </span>
        {:else if ev}
          <span class="why">Matches the name</span>
        {/if}
        <span class="sub2">by <span class="who">{c.displayName ?? `@${c.handle}`}</span> <Dot /> {plural(c.feedCount, 'feed')}{#if c.description} <Dot /> {c.description}{/if}</span>
      </div>
      <span class="chev" aria-hidden="true">›</span>
    </a>
  </li>
{/snippet}

<!--
  A post's title is its link, stretched over the whole row, so the row still
  opens the post. The feed's icon and name sit above it as buttons that open
  the feed's card instead: a button can't go inside a link. The icon is for
  the pointer; the name is the one keyboard stop for it.
-->
{#snippet postRow(p: SearchPost)}
  <li class="post">
    <div class="row">
      <button class="feedicon" tabindex="-1" onclick={() => openSource(p)} aria-label="About {p.feedTitle ?? hostOf(p.siteUrl)}" title="About {p.feedTitle ?? hostOf(p.siteUrl)}">
        <SourceIcon feedId={p.feedId} hasIcon={p.hasIcon} name={p.feedTitle ?? ''} size={40} />
      </button>
      <div class="meta">
        <a class="title whole" href={webHref(p.url) ?? feedHref({ id: p.feedId })} target={webHref(p.url) ? '_blank' : undefined} rel={webHref(p.url) ? 'noreferrer' : undefined}>{p.title ?? p.url}</a>
        <!-- Plenty of feeds set the author to the feed's own name; saying it twice is noise. -->
        <span class="sub2 byline"><button class="feedname" onclick={() => openSource(p)} title="About {p.feedTitle ?? hostOf(p.siteUrl)}">{p.feedTitle ?? hostOf(p.siteUrl)}</button> <Dot /> {relativeTime(p.publishedAt)}{#if p.author && p.author !== p.feedTitle}<span>{' '}<Dot />{' '}{p.author}</span>{/if}</span>
        {#if p.snippet}
          <span class="desc">{#each highlight(p.snippet) as part}{#if part.hit}<mark>{part.text}</mark>{:else}{part.text}{/if}{/each}</span>
        {/if}
      </div>
    </div>
    {#if session.user}
      <button class="save tap" class:on={!!p.bookmarkId} onclick={() => toggleBookmark(p)} disabled={markBusy === p.id} aria-pressed={!!p.bookmarkId}>
        {p.bookmarkId ? 'Bookmarked' : 'Bookmark'}
      </button>
    {/if}
  </li>
{/snippet}

{#snippet personRow(u: ExploreUser | SearchPerson, ev: SearchPerson | null)}
  <li>
    <a class="row tap" href={profileHref(u.handle)} onclick={() => (opened = { person: u.handle })}>
      <Avatar handle={u.handle} name={u.displayName ?? u.handle} size={40} v={u.avatarUpdatedAt} />
      <div class="meta">
        <span class="title">{u.displayName ?? u.handle} <span class="handle">@{u.handle}</span></span>
        {#if ev && ev.notesMatch + ev.marksMatch > 0}
          <span class="why">
            {#if ev.notesMatch}<strong>{plural(ev.notesMatch, 'note')}</strong> about “{q}”{/if}
            {#if ev.notesMatch && ev.marksMatch} <Dot /> {/if}
            {#if ev.marksMatch}<strong>{plural(ev.marksMatch, 'bookmark')}</strong> about “{q}”{/if}
          </span>
        {/if}
        <span class="sub2">
          {plural(u.feeds, 'feed')} <Dot /> {u.collections} public {u.collections === 1 ? 'collection' : 'collections'}{#if u.bio} <Dot /> {u.bio}{/if}
        </span>
      </div>
    </a>
    {#if ev?.isMe}<span class="me">It’s you!</span>
    {:else}<FollowButton following={u.isFollowing} busy={followBusy === u.handle} onclick={() => toggleFollow(u)} />{/if}
  </li>
{/snippet}

{#snippet emptyMessage()}
  <div class="empty">
    {#if searching}
      <p>No {scopeLabel.toLowerCase()} match “{q}”. {#if scope !== 'posts'}<button class="link" onclick={() => setScope('posts')}>Search posts instead</button>, or try{:else}Try{/if} another tab above.</p>
    {:else if scope === 'posts'}
      {#if feedsNetwork}<p>Nothing new from the feeds the people you follow read. <button class="link" onclick={() => setParams({ by: null })}>Show everyone’s</button>.</p>
      {:else}<p>No posts yet. Follow a feed and its posts will turn up here.</p>{/if}
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
{/snippet}

<!-- What the tabs above switch between. -->
<div id="explore-results" role="tabpanel" aria-label={scopeLabel}>
{#if error}
  <p class="status error" role="alert">Couldn’t load: {error}</p>
{:else if nothing}
  <!-- Browsing, the message takes the rows' place inside the list card, so a filter that empties the list
       leaves the filters where they were. A search's filters always sit above its cards, so its message does too. -->
  {#if viaSearch}
    {@render filterBar()}
    {@render emptyMessage()}
  {:else}
    <Card kind="list" as="div" class="browse">{@render filterBar()}{@render emptyMessage()}</Card>
  {/if}
{:else if viaSearch}
  <!-- Its filters show at once; the list arrives under them. -->
  {@render filterBar()}
  {#if res}<section class="group">
    <h2>{#if searching}{scopeLabel}{#if total !== null} <Badge>{total.toLocaleString()}</Badge>{/if}{:else}Newest posts{/if}</h2>
    <Card kind="list" as="ul">
      {#if scope === 'feeds'}{#each rows as f ((f as SearchFeed).id)}{@render feedRow(f as SearchFeed, f as SearchFeed)}{/each}
      {:else if scope === 'collections'}{#each rows as c ((c as SearchCollection).id)}{@render colRow(c as SearchCollection, c as SearchCollection)}{/each}
      {:else if scope === 'posts'}{#each rows as p ((p as SearchPost).id)}{@render postRow(p as SearchPost)}{/each}
      {:else}{#each rows as u ((u as SearchPerson).handle)}{@render personRow(u as SearchPerson, u as SearchPerson)}{/each}{/if}
    </Card>
  </section>{/if}
{:else if browseAs === 'feeds'}
  <Card kind="list" as="div" class="browse">{@render filterBar()}<ul class="list">{#each feeds as f (f.id)}{@render feedRow(f, null)}{/each}</ul></Card>
{:else if browseAs === 'collections'}
  <Card kind="list" as="div" class="browse">{@render filterBar()}<ul class="list">{#each cols as c (c.id)}{@render colRow(c, null)}{/each}</ul></Card>
{:else}
  <Card kind="list" as="div" class="browse">{@render filterBar()}<ul class="list">{#each users as u (u.handle)}{@render personRow(u, null)}{/each}</ul></Card>
{/if}

</div>

{#if loading}<p class="status">Loading…</p>{/if}
<div bind:this={sentinel} aria-hidden="true"></div>

{#if threeFilters}
  <Sheet title="Filters" lede="Choose what this list shows and in what order." bind:dialog={filtersDialog}>
    <div class="sheet-rows">{@render filterFields()}</div>
  </Sheet>
{/if}

{#if source}
  <FeedPopover feedId={source.feedId} hasIcon={source.hasIcon} name={source.name} onclose={() => (source = null)} />
{/if}

<style>
  .pane { margin-bottom: var(--space-2); }
  .head { margin-bottom: var(--space-5); }
  .pane :global(.scopes) { margin-bottom: var(--space-1); }
  h2 { font-family: var(--font-headings); font-size: calc(var(--text-xl) * var(--size-headings)); margin: 0; display: flex; align-items: baseline; gap: var(--space-2); }
  /* The per-view explainer: the caption above the filters, saying what this
     view is before its controls. A small accent-tinted icon sets it apart from
     the plain text below; the icon's left edge lines up with the filter labels. */
  /* Icon flows inline with the text so it always rides beside the first word —
     centered together, and never pinned to the edge when the text fills the line. */
  /* Browsing, the filters and list are one card; the caption leads it, inset to
     match the card's side padding. */
  :global(.browse) :global(.blurb) { margin: 0; padding: var(--space-5) var(--space-3) var(--space-2); }
  .group { margin-bottom: var(--space-5); }
  .group h2 { margin-bottom: var(--space-2); }
  .filters { display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-4); align-items: center; margin-bottom: var(--space-1); }
  /* The note under the filters saying what the chosen order means. */
  .sort-help { margin: 0 0 var(--space-3); color: var(--text-2); font-size: calc(var(--text-sm) * var(--size-app)); line-height: 1.4; text-wrap: pretty; }
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
  /* The folded row. Drawn as a box with the dropdown's own outline, corner and
     caret, so it reads as something to press rather than a line of text: an
     icon, what it is, and what's chosen now. */
  .filters-row {
    display: flex; align-items: center; gap: var(--space-3); width: 100%; min-height: 52px; text-align: left;
    padding: var(--space-2) var(--space-3); margin-bottom: var(--space-2);
    border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface);
  }
  /* Inside the list card it keeps the card's side padding around it. */
  :global(.browse) .filters-row { width: calc(100% - var(--card-pad) * 2); margin: var(--space-3) var(--card-pad) var(--space-2); }
  .fr-icon { flex: none; color: var(--accent); }
  .fr-text { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  .fr-name { font-weight: 600; color: var(--text); line-height: 1.25; }
  .fr-now { font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); overflow-wrap: anywhere; }
  /* Each choice stays on one line, so a long summary breaks at the dots, never mid-phrase. */
  .fr-part { white-space: nowrap; }
  .fr-caret { flex: none; display: grid; color: var(--text-2); }
  /* Browse: the filters are the list card's header, so the two read as one unit; the rows below are part of the same card. */
  .list { list-style: none; margin: 0; padding: 0; }
  :global(.browse) .filters { margin: 0; padding: var(--space-3) var(--card-pad) var(--space-1); }
  li { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--space-4); border-top: 1px solid var(--line); flex-wrap: wrap; }
  /* On a phone a row's button would squeeze the description into a column
     four words wide, so it drops to its own line and the text gets the row.
     Every kind of row keeps that button at the right, so they all line up. */
  @media (max-width: 560px) {
    li > :global(.row) { flex-basis: 100%; }
    li > :global(.follow), li > .save, li > .me { margin-left: auto; }
  }
  li:first-child { border-top: 0; }
  .row { flex: 1; min-width: 0; display: flex; align-items: center; gap: var(--space-3); }
  .meta { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .named { display: flex; align-items: center; gap: var(--space-2); min-width: 0; }
  .named :global(.own) { flex: none; }
  .title { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .handle { font-weight: 400; color: var(--text-2); font-size: calc(var(--text-sm) * var(--size-app)); margin-left: var(--space-1); }
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
  /* Where your own row's Follow would be: Following's tint, but nothing to press. */
  .me { flex: none; padding: var(--space-2) var(--space-4); border-radius: var(--radius-pill); background: var(--accent-tint); color: var(--accent); font-size: calc(var(--text-sm) * var(--size-app)); font-weight: 600; white-space: nowrap; }
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
  .save { flex: none; padding: var(--space-2) var(--space-4); border-radius: var(--radius-pill); border: 1px solid var(--accent); color: var(--accent); background: var(--surface); font-size: calc(var(--text-sm) * var(--size-app)); font-weight: 600; }
  .save.on { background: var(--accent-tint); border-color: transparent; }
  .save:disabled { opacity: 0.6; }
  /* A post row: the title's link covers the row; the feed's buttons and Bookmark sit over it. */
  li.post { position: relative; }
  .whole::after { content: ''; position: absolute; inset: 0; }
  .feedicon, .feedname, li.post .save { position: relative; z-index: 1; }
  .feedicon { flex: none; display: inline-flex; border-radius: var(--radius-avatar); }
  .feedname { font-weight: 600; }
  @media (hover: hover) { .feedname:hover, li.post:has(.whole:hover) .title { text-decoration: underline; text-underline-offset: 3px; } }
  .status { text-align: center; color: var(--text-2); font-size: calc(var(--text-sm) * var(--size-app)); padding: var(--space-4) 0; margin: 0; }
  .status.error { color: var(--danger); }
  .empty { text-align: center; color: var(--text-2); padding: calc(var(--space-6) + var(--space-1)) var(--space-4); font-size: calc(var(--text-base) * var(--size-app)); }
  .empty p { margin: 0 auto; max-width: 480px; }
  .link { color: var(--accent); font-weight: 600; font-size: inherit; }
</style>
