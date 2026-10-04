<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { api, bookmarksApi, profileHref, type Bookmark, type BookmarkSources } from '$lib/api';
  /**
   * My Bookmarks: every post I've saved, and my note on each one that has one
   * (issue #84: a note is part of a bookmark). Newest activity first: saving a
   * post, or writing or editing its note, brings it to the top.
   *
   * The search field at the top (issue #98) narrows the list as I type, over
   * what I saved and what I wrote: title, summary, site name, address and
   * note. It is one more filter: it combines with the others and keeps the
   * same order, and the matched words are highlighted on each card.
   */
  import { session } from '$lib/session.svelte';
  import BookmarkCard from '$lib/components/BookmarkCard.svelte';
  import Button from '$lib/components/Button.svelte';
  import Field from '$lib/components/Field.svelte';
  import Input from '$lib/components/Input.svelte';
  import Tabs from '$lib/components/Tabs.svelte';
  import Select from '$lib/components/Select.svelte';
  import ChoiceGroup from '$lib/components/ChoiceGroup.svelte';
  import { showToast } from '$lib/toast.svelte';

  let list = $state<Bookmark[]>([]);
  let cursor = $state<string | null>(null);
  let done = $state(false);
  let loading = $state(false);
  let sources = $state<BookmarkSources>({ feeds: [], collections: [], total: 0, noted: 0 });
  let sentinel = $state<HTMLElement | null>(null);

  // Filters live in the URL: ?c=<collection> or ?f=<feed>, one at a time so the pills stay honest,
  // and ?notes=1 on top of either: "With notes" narrows whatever else is chosen.
  // ?q=<words> is the search, on top of all of them, so a search can be kept, sent, and come back to.
  const notes = $derived(page.url.searchParams.get('notes') === '1');
  const collection = $derived(page.url.searchParams.get('c') ? Number(page.url.searchParams.get('c')) : null);
  const feed = $derived(page.url.searchParams.get('f') ? Number(page.url.searchParams.get('f')) : null);
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
  const hasFilters = $derived(sources.collections.length > 0 || sources.feeds.length > 0);
  const hasNotesFilter = $derived(sources.noted > 0 || notes);
  /* Nothing to search until something is saved; a search already in the address always shows its field. */
  const hasSearch = $derived(sources.total > 0 || q.length > 0);
  /* One tab per collection, plus All. Filtering by source instead leaves no
     tab chosen, which is what the empty value here means. */
  const filterTabs = $derived([
    { value: 'all', label: 'All' },
    ...sources.collections.map((c) => ({ value: String(c.id), label: c.name, count: c.count }))
  ]);
  const filterValue = $derived(collection ? String(collection) : feed ? '' : 'all');

  /* Which load is the current one. Typing changes the search faster than the
     answers come back, so an answer to an older question is dropped. */
  let asked = 0;

  async function loadMore(reset = false) {
    if (!reset && (loading || done)) return;
    const mine = reset ? ++asked : asked;
    loading = true;
    try {
      const pg = await bookmarksApi.list({ before: reset ? null : cursor, collection, feed, notes, q, limit: 30 });
      if (mine !== asked) return;
      list = reset ? pg.bookmarks : [...list, ...pg.bookmarks];
      cursor = pg.nextCursor;
      done = pg.nextCursor === null;
    } finally {
      if (mine === asked) loading = false;
    }
  }

  /** The page's address with some of its filters changed. Whatever isn't named stays as it was. */
  function address(change: Record<string, string | null>) {
    const p = new URLSearchParams(page.url.searchParams);
    for (const [k, v] of Object.entries(change)) v ? p.set(k, v) : p.delete(k);
    return p.size ? `/bookmarks?${p}` : '/bookmarks';
  }

  /** Choose a collection or source (or neither). "With notes" and the search stay as they were. */
  function setFilter(kind: 'c' | 'f' | null, id?: number) {
    api.event('bookmarks_filter', { kind, id });
    void goto(address({ c: kind === 'c' && id ? String(id) : null, f: kind === 'f' && id ? String(id) : null }), { replaceState: true });
  }

  /** Turn "With notes" on or off, keeping the collection or source, and the search. */
  function setNotes(on: boolean) {
    api.event('bookmarks_filter', { kind: 'notes', on });
    void goto(address({ notes: on ? '1' : null }), { replaceState: true });
  }

  /** Put the search in the address, which is what runs it. The words themselves are never logged. */
  function search(words: string) {
    clearTimeout(timer);
    const term = words.trim();
    if (term === q) return;
    if (term) api.event('bookmarks_search', { length: term.length, filtered: !!(collection || feed || notes) });
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
  async function remove(b: Bookmark) {
    const snapshot = list;
    list = list.filter((x) => x.id !== b.id);
    const removed = await bookmarksApi.remove(b.id);
    api.event('bookmark_removed', { bookmarkId: b.id, via: 'bookmarks_page', hadNote: !!b.note });
    sources.total--;
    if (b.note) sources.noted--;
    showToast(b.note ? 'Removed bookmark and note' : 'Removed bookmark', {
      label: 'Undo',
      run: async () => {
        const back = await bookmarksApi.restore(removed);
        list = snapshot.map((x) => (x.id === b.id ? { ...x, id: back.id, note: x.note && { ...x.note, id: back.id } } : x));
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
    const key = `${notes}|${collection}|${feed}|${q}`;
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
  <p class="sub">Posts you've saved, and your notes on them. {#if !shared}Only you can see them.{:else}Shown on <a href={profileHref(shared.handle)}>your profile</a>{shared.text}.{/if}</p>
</header>

{#if hasSearch}
  <div class="search">
    <Field label="Search your bookmarks and notes" hideLabel>
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
  </div>
{/if}
{#if hasFilters}
  <div class="filters">
    <Tabs
      class="tabs"
      tabs={filterTabs}
      value={filterValue}
      onchange={(v) => (v === 'all' ? setFilter(null) : setFilter('c', Number(v)))}
      label="Filter bookmarks"
      panel="bookmark-results"
    />
  </div>
{/if}
{#if (hasFilters && sources.feeds.length > 1) || hasNotesFilter}
  <div class="controls">
    {#if sources.feeds.length > 1}
      <Select
        class="by-source"
        label="Filter by source"
        hideLabel
        size="sm"
        value={feed ? String(feed) : ''}
        options={[
          { value: '', label: 'By source…' },
          ...sources.feeds.map((f) => ({ value: String(f.feedId), label: `${f.title ?? 'Untitled'} (${f.count})` }))
        ]}
        onchange={(e) => { const v = e.currentTarget.value; v ? setFilter('f', Number(v)) : setFilter(null); }}
      />
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

<!-- What the tabs above switch between. -->
<div id="bookmark-results" role={hasFilters ? 'tabpanel' : undefined}>
  {#if !loading && list.length === 0}
    <div class="empty">
      {#if q}
        <h2>No bookmarks match “{q}”</h2>
        <p>{#if collection || feed || notes}Only the bookmarks under the filter above were searched. {/if}Search looks at titles, summaries, site names, addresses and your notes.</p>
        <div class="ctas"><Button onclick={clearSearch}>Clear search</Button></div>
      {:else if notes && !(collection || feed)}
        <h2>No notes yet</h2>
        <p>Every post has a note button next to its bookmark. Press it, write what you thought, and the post is saved here with your note. Depending on your settings, people who follow you can read your notes under the post.</p>
      {:else if collection || feed || notes}
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
        <h2>Nothing saved yet</h2>
        <p>Every post has a bookmark in its top right corner. Press it and the post is kept here for as long as you like, even after it has scrolled out of All my feeds. Save what you want to read later, come back to, or share from your profile.</p>
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
    {#if loading}<p class="status">Loading…</p>{/if}
    <div bind:this={sentinel} aria-hidden="true"></div>
  {/if}
</div>

<style>
  .top { margin-bottom: var(--space-3); }
  h1 { font-family: var(--font-headings); font-size: calc(var(--text-2xl) * var(--size-headings)); margin: 0; }
  /* 2px is an optical nudge under the title, not a spacing step. */
  .sub { margin: 2px 0 0; color: var(--text-2); font-size: calc(var(--text-sm) * var(--size-app)); }
  .sub a { color: var(--accent); font-weight: 600; }
  /* The collections get the whole width to slide along; the source menu sits
     on its own line under them, so neither one squeezes the other. */
  .search { margin-bottom: var(--space-3); }
  .filters { margin-bottom: var(--space-3); }
  /* Narrow enough to read as a filter rather than a form field, and it never
     runs past the edge of a phone. */
  /* The source menu and the With notes choice share a row under the tabs,
     wrapping onto two lines on a narrow phone. */
  .controls { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); margin: calc(-1 * var(--space-1)) 0 var(--space-3); }
  .controls :global(.by-source) { flex: 1 1 200px; max-width: 280px; }
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
  .status { text-align: center; color: var(--text-2); font-size: calc(var(--text-sm) * var(--size-app)); padding: var(--space-4) 0; }
</style>
