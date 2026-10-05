<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { api, ApiError, bookmarksApi, profileHref, type Bookmark, type BookmarkSources } from '$lib/api';
  /**
   * My Bookmarks: every post I've saved, and my note on each one that has one
   * (issue #84: a note is part of a bookmark). Newest activity first: saving a
   * post, or writing or editing its note, brings it to the top.
   *
   * The search field under the collection tabs (issue #98) narrows the list
   * as I type, over what I saved and what I wrote: title, summary, site name,
   * address and note. It searches inside the chosen tab and keeps the same
   * order, and the matched words are highlighted on each card. It stands in
   * for a menu of sources: typing a site's name finds what came from it.
   */
  import { session } from '$lib/session.svelte';
  import BookmarkCard from '$lib/components/BookmarkCard.svelte';
  import Button from '$lib/components/Button.svelte';
  import Field from '$lib/components/Field.svelte';
  import Input from '$lib/components/Input.svelte';
  import Tabs from '$lib/components/Tabs.svelte';
  import ChoiceGroup from '$lib/components/ChoiceGroup.svelte';
  import { removeBookmark, withBookmarkBack } from '$lib/saves';
  import { site, loadSite } from '$lib/site.svelte';
  import { openFeedback } from '$lib/feedback.svelte';

  let list = $state<Bookmark[]>([]);
  let cursor = $state<string | null>(null);
  let done = $state(false);
  let loading = $state(false);
  let sources = $state<BookmarkSources>({ collections: [], total: 0, noted: 0 });
  let sentinel = $state<HTMLElement | null>(null);

  // Filters live in the URL: ?c=<collection>, and ?notes=1 on top of it: "With notes" narrows the tab.
  // ?q=<words> is the search, on top of both, so a search can be kept, sent, and come back to.
  const notes = $derived(page.url.searchParams.get('notes') === '1');
  const collection = $derived(page.url.searchParams.get('c') ? Number(page.url.searchParams.get('c')) : null);
  const q = $derived((page.url.searchParams.get('q') ?? '').trim());
  let loadedKey = $state<string | undefined>(undefined);

  /* What is in the search field. It runs a little ahead of the address while
     I type, and follows the address when that changes some other way (Back, a
     saved link). */
  let draft = $state('');
  let searchInput = $state<HTMLInputElement | null>(null);
  let timer: ReturnType<typeof setTimeout>;
  $effect(() => {
    const now = q;
    untrack(() => { if (draft.trim() !== now) draft = now; });
  });

  /*
   * Who sees this page's contents on my profile. Bookmarks and notes have
   * their own audiences, so both count: notes shared while bookmarks are
   * private still put the noted posts on my profile.
   */
  const TO = { public: 'anyone', friends: 'the people you follow', private: 'no one else' } as const;
  const shared = $derived.by(() => {
    const me = session.user;
    if (!me || me.profileVisibility !== 'public') return null;
    const marks = me.bookmarksVisibility, notes = me.notesVisibility;
    if (marks === 'private' && notes === 'private') return null;
    const text = marks === notes
      ? (marks === 'friends' ? ' to the people you follow' : '')
      : `: your bookmarks to ${TO[marks]}, your notes to ${TO[notes]}`;
    return { handle: me.handle, text };
  });
  const hasFilters = $derived(sources.collections.length > 0);
  const hasNotesFilter = $derived(sources.noted > 0 || notes);
  /* Nothing to search until something is saved; a search already in the address always shows its field. */
  const hasSearch = $derived(sources.total > 0 || q.length > 0);
  /* One tab per collection, plus All. Each carries how many bookmarks it holds. */
  const filterTabs = $derived([
    { value: 'all', label: 'All', count: sources.total },
    ...sources.collections.map((c) => ({ value: String(c.id), label: c.name, count: c.count }))
  ]);
  const filterValue = $derived(collection ? String(collection) : 'all');

  /* Which load is the current one. Typing changes the search faster than the
     answers come back, so an answer to an older question is dropped. */
  let asked = 0;

  /*
   * A load that didn't come back, said instead of the list. `fresh` is a new
   * search or filter, whose answer replaces the cards; otherwise it was the
   * next page, and the cards above it stay. `ours` is a failure on thicket's
   * side (the server answered, but with an error), as against no answer at all.
   */
  let failed = $state<{ fresh: boolean; ours: boolean } | null>(null);
  const hosted = $derived(site.status?.hosted ?? false);

  async function loadMore(reset = false) {
    if (!reset && (loading || done || failed)) return;
    const mine = reset ? ++asked : asked;
    loading = true;
    if (reset) failed = null;
    try {
      const pg = await bookmarksApi.list({ before: reset ? null : cursor, collection, notes, q, limit: 30 });
      if (mine !== asked) return;
      list = reset ? pg.bookmarks : [...list, ...pg.bookmarks];
      cursor = pg.nextCursor;
      done = pg.nextCursor === null;
    } catch (e) {
      if (mine !== asked) return;
      // A proxy's 502 to 504 means thicket itself didn't answer (restarting, say), the same as no answer.
      const ours = e instanceof ApiError && e.status < 502;
      failed = { fresh: reset, ours };
      if (ours && !site.status) void loadSite();
      // The server logs its own side; this says which page and what came back. Never the search words.
      api.event('bookmarks_load_failed', { status: e instanceof ApiError ? e.status : null, message: (e instanceof Error ? e.message : String(e)).slice(0, 200), searched: !!q, fresh: reset });
    } finally {
      if (mine === asked) loading = false;
    }
  }

  function retry() {
    void loadMore(failed?.fresh ?? true);
  }

  /** The page's address with some of its filters changed. Whatever isn't named stays as it was. */
  function address(change: Record<string, string | null>) {
    const p = new URLSearchParams(page.url.searchParams);
    for (const [k, v] of Object.entries(change)) v ? p.set(k, v) : p.delete(k);
    return p.size ? `/bookmarks?${p}` : '/bookmarks';
  }

  /** Choose a collection, or All. "With notes" and the search stay as they were. */
  function setCollection(id: number | null) {
    api.event('bookmarks_filter', { kind: id ? 'c' : null, id });
    // ?f= was the old source menu; a saved link that still carries it drops it here.
    void goto(address({ c: id ? String(id) : null, f: null }), { replaceState: true });
  }

  /** Turn "With notes" on or off, keeping the collection and the search. */
  function setNotes(on: boolean) {
    api.event('bookmarks_filter', { kind: 'notes', on });
    void goto(address({ notes: on ? '1' : null }), { replaceState: true });
  }

  /** Put the search in the address, which is what runs it. The words themselves are never logged. */
  function search(words: string) {
    clearTimeout(timer);
    const term = words.trim();
    if (term === q) return;
    if (term) api.event('bookmarks_search', { length: term.length, filtered: !!(collection || notes) });
    void goto(address({ q: term || null }), { replaceState: true, keepFocus: true, noScroll: true });
  }

  /** Typing searches after a short pause, so the list isn't redrawn on every letter. */
  function onSearch(v: string) {
    draft = v;
    clearTimeout(timer);
    timer = setTimeout(() => search(v), 250);
  }

  function clearSearch() {
    draft = '';
    search('');
    searchInput?.focus();
  }

  /** Remove a bookmark, and its note with it. Undo puts both back where they were. */
  function remove(b: Bookmark) {
    const snapshot = list;
    void removeBookmark(b, 'bookmarks_page', {
      drop: () => {
        list = list.filter((x) => x.id !== b.id);
        sources.total--;
        if (b.note) sources.noted--;
      },
      putBack: (id) => {
        list = withBookmarkBack(list, snapshot, b.id, id);
        sources.total++;
        if (b.note) sources.noted++;
      }
    });
  }

  /** A note written or deleted here. Under "With notes", a deleted one takes its card with it. */
  function noteChanged(b: Bookmark, note: Bookmark['note'], had: boolean) {
    if (note && !had) sources.noted++;
    if (!note && had) sources.noted--;
    if (!note && notes) list = list.filter((x) => x.id !== b.id);
  }

  onMount(() => {
    api.event('bookmarks_view');
    void bookmarksApi.sources().then((s) => (sources = s));
  });

  $effect(() => {
    const key = `${notes}|${collection}|${q}`;
    if (loadedKey === key) return;
    loadedKey = key;
    // The cards on screen stay until the new ones arrive, so typing a search doesn't blink the list away.
    void loadMore(true);
  });

  $effect(() => {
    if (!sentinel) return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) void loadMore(); }, { rootMargin: '800px 0px' });
    io.observe(sentinel);
    return () => io.disconnect();
  });
</script>

<svelte:head><title>My Bookmarks · thicket</title></svelte:head>

<header class="top">
  <h1>My Bookmarks</h1>
  <p class="sub">Posts you've bookmarked and your notes on them. {#if !shared}Only you can see them.{:else}Shown on <a href={profileHref(shared.handle)}>your profile</a>{shared.text}.{/if}</p>
</header>

{#if hasFilters}
  <div class="filters">
    <Tabs
      class="tabs"
      tabs={filterTabs}
      value={filterValue}
      onchange={(v) => setCollection(v === 'all' ? null : Number(v))}
      label="Filter bookmarks"
      panel="bookmark-results"
    />
  </div>
{/if}
{#if hasSearch || hasNotesFilter}
  <!-- Search and With notes both narrow whichever tab is chosen above. -->
  <div class="controls">
    {#if hasSearch}
      <Field class="find" label="Search your bookmarks and notes" hideLabel>
        {#snippet children({ id })}
          <Input
            {id}
            bind:element={searchInput}
            variant="search"
            value={draft}
            oninput={(e) => onSearch(e.currentTarget.value)}
            onclear={clearSearch}
            onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter') search(draft); }}
            placeholder="Search your bookmarks and notes"
            autocomplete="off"
            enterkeyhint="search"
          />
        {/snippet}
      </Field>
    {/if}
    {#if hasNotesFilter}
      <ChoiceGroup
        class="with-notes"
        size="sm"
        label="Show all bookmarks, or only the ones with a note"
        options={[{ value: 'all', label: 'all bookmarks' }, { value: 'notes', label: 'with notes' }]}
        value={notes ? 'notes' : 'all'}
        onchange={(v) => setNotes(v === 'notes')}
      />
    {/if}
  </div>
{/if}

{#snippet failure()}
  <div class="empty" role="alert">
    <h2>{q ? 'Couldn’t search your bookmarks' : 'Couldn’t load your bookmarks'}</h2>
    {#if failed?.ours}
      <p>Something went wrong on thicket’s side. Try again{#if hosted}, and if it keeps happening, <button type="button" class="inline" onclick={openFeedback}>send feedback</button>{/if}.</p>
    {:else if typeof navigator !== 'undefined' && !navigator.onLine}
      <p>You’re offline. Reconnect and try again.</p>
    {:else}
      <p>thicket isn’t answering right now. Try again in a minute.</p>
    {/if}
    <div class="ctas"><Button onclick={retry} disabled={loading}>Try again</Button></div>
  </div>
{/snippet}

<!-- What the tabs above switch between. -->
<div id="bookmark-results" role={hasFilters ? 'tabpanel' : undefined}>
  {#if failed?.fresh}
    {@render failure()}
  {:else if !loading && done && list.length === 0}
    <div class="empty">
      {#if q}
        <h2>No bookmarks match “{q}”</h2>
        <p>{#if collection || notes}Only the bookmarks under the filter above were searched. {/if}Search looks at titles, summaries, site names, addresses and your notes.</p>
        <div class="ctas"><Button onclick={clearSearch}>Clear search</Button></div>
      {:else if notes && !collection}
        <h2>No notes yet</h2>
        <p>Every post has a note button next to its bookmark. Press it, write what you thought, and the post is saved here with your note. Depending on your settings, people who follow you can read your notes under the post.</p>
      {:else if collection || notes}
        <h2>No bookmarks match this filter.</h2>
      {:else}
        <!-- A post card, drawn small, with the bookmark corner lit up: this is the thing to press. -->
        <svg class="illo" viewBox="0 0 260 120" width="260" height="120" aria-hidden="true">
          <rect x="8" y="10" width="244" height="100" rx="14" fill="var(--surface)" stroke="var(--line)" />
          <circle cx="34" cy="34" r="9" fill="var(--surface-2)" />
          <rect x="50" y="29" width="70" height="10" rx="5" fill="var(--surface-2)" />
          <rect x="24" y="56" width="200" height="12" rx="6" fill="var(--line)" />
          <rect x="24" y="76" width="150" height="12" rx="6" fill="var(--line)" />
          <circle cx="222" cy="36" r="20" fill="color-mix(in srgb, var(--accent) 18%, transparent)" />
          <circle cx="222" cy="36" r="20" fill="none" stroke="var(--accent)" stroke-width="2" stroke-dasharray="4 4" />
          <path d="M215 27h14v18l-7-4.5-7 4.5z" fill="var(--accent)" />
        </svg>
        <h2>No bookmarks yet</h2>
        <p>Every post has a bookmark in its top right corner. Press it and the post is kept here for as long as you like, even after it has scrolled out of All my feeds. Bookmark what you want to read later, come back to, or share from your profile.</p>
        <div class="ctas"><Button variant="primary" size="lg" href="/everything">Go to All my feeds</Button><Button size="lg" href="/explore">Explore feeds</Button></div>
      {/if}
    </div>
    {#if q}
      <!-- Not saved, but it may still be out there: the same words, searched across everything. -->
      <p class="elsewhere"><a href="/explore?q={encodeURIComponent(q)}" onclick={() => api.event('bookmarks_search_everywhere')}>Search all of thicket for “{q}”</a></p>
    {/if}
  {:else}
    <ul class="list">
      {#each list as b (b.id)}
        <BookmarkCard {b} mine heading="h2" onopen={() => api.event('bookmark_opened', { bookmarkId: b.id })}
          onnote={(n, had) => noteChanged(b, n, had)}
          action={{ kind: 'remove', on: true, label: b.note ? 'Remove bookmark and note' : 'Remove bookmark', run: () => remove(b) }} />
      {/each}
    </ul>
    {#if failed}{@render failure()}{:else if loading}<p class="status">Loading…</p>{/if}
    <div bind:this={sentinel} aria-hidden="true"></div>
  {/if}
</div>

<style>
  .top { margin-bottom: var(--space-3); }
  h1 { font-family: var(--font-headings); font-size: calc(var(--text-2xl) * var(--size-headings)); margin: 0; }
  /* 2px is an optical nudge under the title, not a spacing step. */
  .sub { margin: 2px 0 0; color: var(--text-2); font-size: calc(var(--text-sm) * var(--size-app)); }
  .sub a { color: var(--accent); font-weight: 600; }
  /* The collections get the whole width to slide along; the search and the
     With notes choice sit on their own line under them, so neither squeezes the tabs. */
  .filters { margin-bottom: var(--space-3); }
  /* The search takes whatever room With notes leaves, and With notes drops
     under it on a phone too narrow for both. */
  .controls { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-3); margin: 0 0 var(--space-3); }
  .controls :global(.find) { flex: 1 1 240px; min-width: 0; }
  .list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-3); }
  .empty { text-align: center; padding: calc(var(--space-6) + var(--space-2)) var(--space-5); color: var(--text-2); }
  .empty h2 { font-family: var(--font-headings); color: var(--text); font-size: calc(var(--text-xl) * var(--size-headings)); margin: 0 0 var(--space-2); }
  .empty p { margin: 0 auto; max-width: 440px; font-size: calc(var(--text-base) * var(--size-app)); }
  .illo { display: block; margin: 0 auto var(--space-4); max-width: 100%; }
  .ctas { display: flex; gap: var(--space-2); justify-content: center; flex-wrap: wrap; margin-top: var(--space-4); }
  /* The way out of an empty search: under the empty state, not inside it. */
  .elsewhere { text-align: center; margin: 0; font-size: calc(var(--text-base) * var(--size-app)); overflow-wrap: anywhere; }
  .elsewhere a { color: var(--accent); font-weight: 600; }
  @media (hover: hover) { .elsewhere a:hover { text-decoration: underline; text-underline-offset: 3px; } }
  /* "send feedback" reads as a link inside the sentence, but opens the feedback Sheet rather than a page. */
  .inline { font: inherit; color: var(--accent); font-weight: 600; background: none; border: 0; padding: 0; cursor: pointer; }
  @media (hover: hover) { .inline:hover { text-decoration: underline; text-underline-offset: 3px; } }
  .status { text-align: center; color: var(--text-2); font-size: calc(var(--text-sm) * var(--size-app)); padding: var(--space-4) 0; }
</style>
