<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { api, bookmarksApi, profileHref, type Bookmark, type BookmarkSources } from '$lib/api';
  import { session } from '$lib/session.svelte';
  import BookmarkCard from '$lib/components/BookmarkCard.svelte';
  import { showToast } from '$lib/toast.svelte';

  let list = $state<Bookmark[]>([]);
  let cursor = $state<string | null>(null);
  let done = $state(false);
  let loading = $state(false);
  let sources = $state<BookmarkSources>({ feeds: [], collections: [] });
  let sentinel = $state<HTMLElement | null>(null);

  // Filters live in the URL: ?c=<collection> or ?f=<feed>. One at a time keeps the pills honest.
  const collection = $derived(page.url.searchParams.get('c') ? Number(page.url.searchParams.get('c')) : null);
  const feed = $derived(page.url.searchParams.get('f') ? Number(page.url.searchParams.get('f')) : null);
  let loadedKey = $state<string | undefined>(undefined);

  async function loadMore(reset = false) {
    if (loading || (done && !reset)) return;
    loading = true;
    try {
      const pg = await bookmarksApi.list({ before: reset ? null : cursor, collection, feed, limit: 30 });
      list = reset ? pg.bookmarks : [...list, ...pg.bookmarks];
      cursor = pg.nextCursor;
      done = pg.nextCursor === null;
    } finally {
      loading = false;
    }
  }

  function setFilter(kind: 'c' | 'f' | null, id?: number) {
    api.event('bookmarks_filter', { kind, id });
    void goto(kind ? `/bookmarks?${kind}=${id}` : '/bookmarks', { replaceState: true });
  }

  async function remove(b: Bookmark) {
    const snapshot = list;
    list = list.filter((x) => x.id !== b.id);
    await bookmarksApi.remove(b.id);
    api.event('bookmark_removed', { bookmarkId: b.id, via: 'bookmarks_page' });
    showToast('Removed bookmark', {
      label: 'Undo',
      run: async () => {
        if (b.itemId) await bookmarksApi.saveItem(b.itemId);
        else await bookmarksApi.saveUrl(b.url, b.title ?? undefined);
        list = snapshot;
      }
    });
  }

  onMount(() => {
    api.event('bookmarks_view');
    void bookmarksApi.sources().then((s) => (sources = s));
  });

  $effect(() => {
    const key = `${collection}|${feed}`;
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
  <p class="sub">Posts you've saved. {#if session.user?.profileVisibility === 'public' && session.user.bookmarksVisibility === 'public'}Shown on <a href={profileHref(session.user.handle)}>your profile</a>.{:else if session.user?.profileVisibility === 'public' && session.user.bookmarksVisibility === 'friends'}Shown on <a href={profileHref(session.user.handle)}>your profile</a> to the people you follow.{:else}Only you can see them.{/if}</p>
</header>

{#if sources.collections.length || sources.feeds.length}
  <div class="filters" role="tablist" aria-label="Filter bookmarks">
    <button role="tab" aria-selected={!collection && !feed} onclick={() => setFilter(null)}>All</button>
    {#each sources.collections as c (c.id)}
      <button role="tab" aria-selected={collection === c.id} onclick={() => setFilter('c', c.id)}>{c.name} <span class="n">{c.count}</span></button>
    {/each}
    {#if sources.feeds.length > 1}
      <select aria-label="Filter by source" value={feed ?? ''} onchange={(e) => { const v = e.currentTarget.value; v ? setFilter('f', Number(v)) : setFilter(null); }}>
        <option value="">By source…</option>
        {#each sources.feeds as f (f.feedId)}<option value={f.feedId}>{f.title ?? 'Untitled'} ({f.count})</option>{/each}
      </select>
    {/if}
  </div>
{/if}

{#if !loading && list.length === 0}
  <div class="empty">
    {#if collection || feed}
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
      <div class="ctas"><a class="cta" href="/">Go to All my feeds</a><a class="cta ghost" href="/feeds">Explore feeds</a></div>
    {/if}
  </div>
{:else}
  <ul class="list">
    {#each list as b (b.id)}
      <BookmarkCard {b} onopen={() => api.event('bookmark_opened', { bookmarkId: b.id })} action={{ kind: 'remove', on: true, label: 'Remove bookmark', run: () => remove(b) }} />
    {/each}
  </ul>
  {#if loading}<p class="status">Loading…</p>{/if}
  <div bind:this={sentinel} aria-hidden="true"></div>
{/if}

<style>
  .top { margin-bottom: 12px; }
  h1 { font-family: var(--font-serif); font-size: 26px; margin: 0; }
  .sub { margin: 2px 0 0; color: var(--text-3); font-size: 14px; }
  .sub a { color: var(--accent); font-weight: 600; }
  .filters { display: flex; gap: 8px; overflow-x: auto; scrollbar-width: none; padding: 2px 0 12px; align-items: center; }
  .filters::-webkit-scrollbar { display: none; }
  .filters button, .filters select {
    flex: none; padding: 7px 14px; border-radius: 999px; background: var(--surface); border: 1px solid var(--line);
    font-size: 14px; color: var(--text-2); white-space: nowrap;
  }
  .filters button[aria-selected='true'] { background: var(--text); color: var(--bg); border-color: var(--text); font-weight: 600; }
  .filters .n { opacity: 0.6; font-size: 12px; margin-left: 2px; }
  .list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
  .empty { text-align: center; padding: 40px 20px; color: var(--text-2); }
  .empty h2 { font-family: var(--font-serif); color: var(--text); font-size: 22px; margin: 0 0 6px; }
  .empty p { margin: 0 auto; max-width: 440px; font-size: 15px; }
  .illo { display: block; margin: 0 auto 16px; max-width: 100%; }
  .ctas { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; margin-top: 18px; }
  .cta { display: inline-block; background: var(--accent); color: var(--accent-ink); padding: 11px 18px; border-radius: 999px; font-weight: 600; font-size: 14px; }
  .cta.ghost { background: var(--surface); color: var(--text-2); border: 1px solid var(--line); }
  .status { text-align: center; color: var(--text-3); font-size: 14px; padding: 16px 0; }
</style>
