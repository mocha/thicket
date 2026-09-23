<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { api, bookmarksApi, profileHref, type Bookmark, type BookmarkSources } from '$lib/api';
  /**
   * My Bookmarks: every post I've saved, and my note on each one that has one
   * (issue #84: a note is part of a bookmark). Newest activity first: saving a
   * post, or writing or editing its note, brings it to the top.
   */
  import { session } from '$lib/session.svelte';
  import BookmarkCard from '$lib/components/BookmarkCard.svelte';
  import Button from '$lib/components/Button.svelte';
  import Tabs from '$lib/components/Tabs.svelte';
  import Select from '$lib/components/Select.svelte';
  import { showToast } from '$lib/toast.svelte';

  let list = $state<Bookmark[]>([]);
  let cursor = $state<string | null>(null);
  let done = $state(false);
  let loading = $state(false);
  let sources = $state<BookmarkSources>({ feeds: [], collections: [], noted: 0 });
  let sentinel = $state<HTMLElement | null>(null);

  // Filters live in the URL: ?notes=1, ?c=<collection> or ?f=<feed>. One at a time keeps the pills honest.
  const notes = $derived(page.url.searchParams.get('notes') === '1');
  const collection = $derived(page.url.searchParams.get('c') ? Number(page.url.searchParams.get('c')) : null);
  const feed = $derived(page.url.searchParams.get('f') ? Number(page.url.searchParams.get('f')) : null);
  let loadedKey = $state<string | undefined>(undefined);
  const hasFilters = $derived(sources.noted > 0 || sources.collections.length > 0 || sources.feeds.length > 0 || notes);
  /* All, the ones with a note, then one tab per collection. Filtering by
     source instead leaves no tab chosen, which is what the empty value here
     means. */
  const filterTabs = $derived([
    { value: 'all', label: 'All' },
    { value: 'notes', label: 'With notes', count: sources.noted },
    ...sources.collections.map((c) => ({ value: String(c.id), label: c.name, count: c.count }))
  ]);
  const filterValue = $derived(notes ? 'notes' : collection ? String(collection) : feed ? '' : 'all');

  async function loadMore(reset = false) {
    if (loading || (done && !reset)) return;
    loading = true;
    try {
      const pg = await bookmarksApi.list({ before: reset ? null : cursor, collection, feed, notes, limit: 30 });
      list = reset ? pg.bookmarks : [...list, ...pg.bookmarks];
      cursor = pg.nextCursor;
      done = pg.nextCursor === null;
    } finally {
      loading = false;
    }
  }

  function setFilter(kind: 'notes' | 'c' | 'f' | null, id?: number) {
    api.event('bookmarks_filter', { kind, id });
    void goto(kind === 'notes' ? '/bookmarks?notes=1' : kind ? `/bookmarks?${kind}=${id}` : '/bookmarks', { replaceState: true });
  }

  /** Remove a bookmark, and its note with it. Undo puts both back where they were. */
  async function remove(b: Bookmark) {
    const snapshot = list;
    list = list.filter((x) => x.id !== b.id);
    const removed = await bookmarksApi.remove(b.id);
    api.event('bookmark_removed', { bookmarkId: b.id, via: 'bookmarks_page', hadNote: !!b.note });
    if (b.note) sources.noted--;
    showToast(b.note ? 'Removed bookmark and note' : 'Removed bookmark', {
      label: 'Undo',
      run: async () => {
        const back = await bookmarksApi.restore(removed);
        list = snapshot.map((x) => (x.id === b.id ? { ...x, id: back.id, note: x.note && { ...x.note, id: back.id } } : x));
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
    const key = `${notes}|${collection}|${feed}`;
    if (loadedKey === key) return;
    loadedKey = key;
    list = []; cursor = null; done = false;
    void loadMore(true);
  });

  $effect(() => {
    if (!sentinel) return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) void loadMore(); }, { rootMargin: '800px 0px' });
    io.observe(sentinel);
    return () => io.disconnect();
  });
</script>

<header class="top">
  <h1>My Bookmarks</h1>
  <p class="sub">Posts you've saved, and your notes on them. {#if session.user?.profileVisibility === 'public' && session.user.bookmarksVisibility === 'public'}Shown on <a href={profileHref(session.user.handle)}>your profile</a>.{:else if session.user?.profileVisibility === 'public' && session.user.bookmarksVisibility === 'friends'}Shown on <a href={profileHref(session.user.handle)}>your profile</a> to the people you follow.{:else}Only you can see them.{/if}</p>
</header>

{#if hasFilters}
  <div class="filters">
    <Tabs
      class="tabs"
      tabs={filterTabs}
      value={filterValue}
      onchange={(v) => (v === 'all' ? setFilter(null) : v === 'notes' ? setFilter('notes') : setFilter('c', Number(v)))}
      label="Filter bookmarks"
      panel="bookmark-results"
    />
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
  </div>
{/if}

<!-- What the tabs above switch between. -->
<div id="bookmark-results" role={hasFilters ? 'tabpanel' : undefined}>
  {#if !loading && list.length === 0}
    <div class="empty">
      {#if notes}
        <h2>No notes yet</h2>
        <p>Every post has a note button next to its bookmark. Press it, write what you thought, and the post is saved here with your note. Depending on your settings, people who follow you can read your notes under the post.</p>
      {:else if collection || feed}
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
        <div class="ctas"><Button variant="primary" size="lg" href="/">Go to All my feeds</Button><Button size="lg" href="/explore">Explore feeds</Button></div>
      {/if}
    </div>
  {:else}
    <ul class="list">
      {#each list as b (b.id)}
        <BookmarkCard {b} mine onopen={() => api.event('bookmark_opened', { bookmarkId: b.id })}
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
  .sub { margin: 2px 0 0; color: var(--text-3); font-size: calc(var(--text-sm) * var(--size-app)); }
  .sub a { color: var(--accent); font-weight: 600; }
  /* The collections get the whole width to slide along; the source menu sits
     on its own line under them, so neither one squeezes the other. */
  .filters { margin-bottom: var(--space-3); }
  /* Narrow enough to read as a filter rather than a form field, and it never
     runs past the edge of a phone. */
  .filters :global(.by-source) { margin-top: var(--space-2); max-width: 280px; }
  .list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-3); }
  .empty { text-align: center; padding: calc(var(--space-6) + var(--space-2)) var(--space-5); color: var(--text-2); }
  .empty h2 { font-family: var(--font-headings); color: var(--text); font-size: calc(var(--text-xl) * var(--size-headings)); margin: 0 0 var(--space-2); }
  .empty p { margin: 0 auto; max-width: 440px; font-size: calc(var(--text-base) * var(--size-app)); }
  .illo { display: block; margin: 0 auto var(--space-4); max-width: 100%; }
  .ctas { display: flex; gap: var(--space-2); justify-content: center; flex-wrap: wrap; margin-top: var(--space-4); }
  .status { text-align: center; color: var(--text-3); font-size: calc(var(--text-sm) * var(--size-app)); padding: var(--space-4) 0; }
</style>
