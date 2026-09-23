<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { api, bookmarksApi, profileHref, profilesApi, type PublicBookmark, type PublicUser } from '$lib/api';
  import { session } from '$lib/session.svelte';
  import BookmarkCard from '$lib/components/BookmarkCard.svelte';
  import ChoiceGroup from '$lib/components/ChoiceGroup.svelte';
  import VisitorMore from '$lib/components/VisitorMore.svelte';
  import { showToast } from '$lib/toast.svelte';

  /**
   * Someone's bookmarks, and their note on each, when they share notes with
   * me (issue #84). Tap the bookmark icon on any of them to keep a copy in
   * your own set. When they share notes but not bookmarks, only the noted
   * posts are here.
   */
  const handle = $derived(page.params.handle ?? '');
  const notes = $derived(page.url.searchParams.get('notes') === '1');
  let owner = $state<PublicUser | null>(null);
  let isMe = $state(false);
  let notedOnly = $state(false);
  let showsNotes = $state(false);
  /* All or With notes, when there is a choice: I may read their notes, and I'm seeing more than the noted posts. */
  const hasNotesFilter = $derived(showsNotes && !notedOnly);
  let list = $state<PublicBookmark[]>([]);
  let cursor = $state<string | null>(null);
  let done = $state(false);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let cappedAt = $state<number | null>(null);
  let sentinel = $state<HTMLElement | null>(null);
  let loadedKey = $state<string | undefined>(undefined);

  async function loadMore(reset = false) {
    if (loading || (done && !reset)) return;
    loading = true; error = null;
    try {
      // Signed out, a limited instance sends one page and no more, so ask for all of it at once.
      const pg = await profilesApi.bookmarks(handle, { before: reset ? null : cursor, limit: session.user ? undefined : 100, notes });
      owner = pg.owner; isMe = pg.isMe; notedOnly = pg.notedOnly; showsNotes = pg.showsNotes;
      list = reset ? pg.bookmarks : [...list, ...pg.bookmarks];
      cursor = pg.nextCursor;
      done = pg.nextCursor === null;
      cappedAt = pg.cappedAt ?? null;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      done = true;
    } finally {
      loading = false;
    }
  }

  /** Save (or unsave) a copy into my own bookmarks. */
  async function toggle(b: PublicBookmark) {
    const removedId = b.myBookmarkId;
    try {
      if (removedId) {
        b.myBookmarkId = null;
        const removed = await bookmarksApi.remove(removedId);
        api.event('bookmark_removed', { via: 'public_bookmarks', hadNote: !!removed.note });
        // My copy may have carried my own note; it went with the bookmark, so say so and offer it back.
        if (removed.note) {
          showToast('Removed bookmark and note', {
            label: 'Undo',
            run: async () => { b.myBookmarkId = (await bookmarksApi.restore(removed)).id; }
          });
        }
      } else {
        const mine = await bookmarksApi.saveFrom(b.id);
        b.myBookmarkId = mine.id;
        api.event('bookmark_saved', { via: 'public_bookmarks', from: handle });
        showToast('Saved to your bookmarks');
      }
    } catch (e) {
      // The remove was optimistic; put the bookmark back if the request failed.
      if (removedId) b.myBookmarkId = removedId;
      showToast(e instanceof Error ? e.message : String(e));
    }
  }

  onMount(() => api.event('public_bookmarks_view', { handle }));
  $effect(() => {
    const key = `${handle}|${notes}`;
    if (loadedKey === key) return;
    loadedKey = key;
    list = []; cursor = null; done = false; cappedAt = null;
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
  <p class="sub">{#if isMe}This is how others see them. <a href="/bookmarks">Manage them here.</a>{:else if notedOnly}The posts {owner?.displayName ?? `@${handle}`} has written a note on. {/if}{#if !isMe}{#if session.user}Tap the bookmark on any post to save a copy to yours.{:else}<a href="/login?next={encodeURIComponent(page.url.pathname)}">Log in</a> to save any of these to your own.{/if}{/if}</p>
</header>

{#if hasNotesFilter}
  <div class="filters">
    <ChoiceGroup
      size="sm"
      label="Show all bookmarks, or only the ones with a note"
      options={[{ value: 'all', label: 'All' }, { value: 'notes', label: 'With notes' }]}
      value={notes ? 'notes' : 'all'}
      onchange={(v) => { api.event('public_bookmarks_filter', { notes: v === 'notes' }); void goto(v === 'notes' ? `${page.url.pathname}?notes=1` : page.url.pathname, { replaceState: true }); }}
    />
  </div>
{/if}

<div id="bookmark-results">
{#if error}
  <div class="empty"><h2>Not here</h2><p>{error === 'not found' ? 'These bookmarks aren’t shared.' : error}</p></div>
{:else if !loading && list.length === 0}
  <div class="empty"><h2>{notes || notedOnly ? 'No notes yet' : 'Nothing saved yet'}</h2></div>
{:else}
  <ul class="list">
    {#each list as b (b.id)}
      <BookmarkCard {b} author={owner} onopen={() => api.event('bookmark_opened', { via: 'public_bookmarks' })}
        action={session.user && !isMe ? { kind: 'save', on: !!b.myBookmarkId, label: b.myBookmarkId ? 'Remove from my bookmarks' : 'Save to my bookmarks', run: () => toggle(b) } : undefined} />
    {/each}
  </ul>
  {#if loading}<p class="status">Loading…</p>{/if}
  {#if cappedAt}<VisitorMore cap={cappedAt} />{/if}
  <div bind:this={sentinel} aria-hidden="true"></div>
{/if}
</div>

<style>
  .crumbs { font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-3); margin-bottom: var(--space-1); }
  .crumbs a { color: var(--accent); font-weight: 600; }
  .top { margin-bottom: var(--space-3); }
  h1 { font-family: var(--font-headings); font-size: calc(var(--text-2xl) * var(--size-headings)); margin: 0; overflow-wrap: anywhere; }
  /* 2px is an optical nudge under the title, not a spacing step. */
  .sub { margin: 2px 0 0; color: var(--text-3); font-size: calc(var(--text-sm) * var(--size-app)); }
  .sub a { color: var(--accent); font-weight: 600; }
  /* The With notes choice gets the same air under it as on My Bookmarks. */
  .filters { margin-bottom: var(--space-3); }
  .list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-3); }
  .empty { text-align: center; padding: calc(var(--space-6) + var(--space-4)) var(--space-5); color: var(--text-2); }
  .empty h2 { font-family: var(--font-headings); color: var(--text); font-size: calc(var(--text-xl) * var(--size-headings)); margin: 0 0 var(--space-2); }
  .status { text-align: center; color: var(--text-3); font-size: calc(var(--text-sm) * var(--size-app)); padding: var(--space-4) 0; }
</style>
