<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { api, bookmarksApi, profileHref, profilesApi, type PublicBookmark, type PublicUser } from '$lib/api';
  import { session } from '$lib/session.svelte';
  import BookmarkCard from '$lib/components/BookmarkCard.svelte';
  import { showToast } from '$lib/toast.svelte';

  /** Someone's bookmarks. Tap the bookmark icon on any of them to keep a copy in your own set. */
  const handle = $derived(page.params.handle ?? '');
  let owner = $state<PublicUser | null>(null);
  let isMe = $state(false);
  let list = $state<PublicBookmark[]>([]);
  let cursor = $state<string | null>(null);
  let done = $state(false);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let sentinel = $state<HTMLElement | null>(null);
  let loadedHandle = $state<string | undefined>(undefined);

  async function loadMore(reset = false) {
    if (loading || (done && !reset)) return;
    loading = true; error = null;
    try {
      const pg = await profilesApi.bookmarks(handle, reset ? null : cursor);
      owner = pg.owner; isMe = pg.isMe;
      list = reset ? pg.bookmarks : [...list, ...pg.bookmarks];
      cursor = pg.nextCursor;
      done = pg.nextCursor === null;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      done = true;
    } finally {
      loading = false;
    }
  }

  /** Save (or unsave) a copy into my own bookmarks. */
  async function toggle(b: PublicBookmark) {
    try {
      if (b.myBookmarkId) {
        const id = b.myBookmarkId;
        b.myBookmarkId = null;
        await bookmarksApi.remove(id);
        api.event('bookmark_removed', { via: 'public_bookmarks' });
      } else {
        const mine = await bookmarksApi.saveFrom(b.id);
        b.myBookmarkId = mine.id;
        api.event('bookmark_saved', { via: 'public_bookmarks', from: handle });
        showToast('Saved to your bookmarks');
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    }
  }

  onMount(() => api.event('public_bookmarks_view', { handle }));
  $effect(() => {
    if (loadedHandle === handle) return;
    loadedHandle = handle;
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

<svelte:head><title>Bookmarks · @{handle} · thicket</title></svelte:head>

<nav class="crumbs"><a href={profileHref(handle)}>@{handle}</a> <span aria-hidden="true">›</span></nav>
<header class="top">
  <h1>{isMe ? 'Your bookmarks' : `${owner?.displayName ?? `@${handle}`}’s bookmarks`}</h1>
  <p class="sub">{#if isMe}This is how others see them. <a href="/bookmarks">Manage them here.</a>{:else if session.user}Tap the bookmark on any post to save a copy to yours.{:else}<a href="/login?next={encodeURIComponent(page.url.pathname)}">Log in</a> to save any of these to your own.{/if}</p>
</header>

{#if error}
  <div class="empty"><h2>Not here</h2><p>{error === 'not found' ? 'These bookmarks aren’t shared.' : error}</p></div>
{:else if !loading && list.length === 0}
  <div class="empty"><h2>Nothing saved yet</h2></div>
{:else}
  <ul class="list">
    {#each list as b (b.id)}
      <BookmarkCard {b} onopen={() => api.event('bookmark_opened', { via: 'public_bookmarks' })}
        action={session.user && !isMe ? { kind: 'save', on: !!b.myBookmarkId, label: b.myBookmarkId ? 'Remove from my bookmarks' : 'Save to my bookmarks', run: () => toggle(b) } : undefined} />
    {/each}
  </ul>
  {#if loading}<p class="status">Loading…</p>{/if}
  <div bind:this={sentinel} aria-hidden="true"></div>
{/if}

<style>
  .crumbs { font-size: 13px; color: var(--text-3); margin-bottom: 4px; }
  .crumbs a { color: var(--accent); font-weight: 600; }
  .top { margin-bottom: 12px; }
  h1 { font-family: var(--font-serif); font-size: 26px; margin: 0; overflow-wrap: anywhere; }
  .sub { margin: 2px 0 0; color: var(--text-3); font-size: 14px; }
  .sub a { color: var(--accent); font-weight: 600; }
  .list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
  .empty { text-align: center; padding: 50px 20px; color: var(--text-2); }
  .empty h2 { font-family: var(--font-serif); color: var(--text); font-size: 22px; margin: 0 0 6px; }
  .status { text-align: center; color: var(--text-3); font-size: 14px; padding: 16px 0; }
</style>
