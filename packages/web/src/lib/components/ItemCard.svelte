<script lang="ts">
  import type { Note, RiverItem } from '$lib/api';
  import { api, bookmarksApi } from '$lib/api';
  import { relativeTime, hostOf } from '$lib/time';
  import { session } from '$lib/session.svelte';
  import SourceIcon from './SourceIcon.svelte';
  import FeedPopover from './FeedPopover.svelte';
  import NoteBlock from './NoteBlock.svelte';
  import NoteEditor from './NoteEditor.svelte';
  import { showToast } from '$lib/toast.svelte';

  let { item, showSource = true }: { item: RiverItem; showSource?: boolean } = $props();
  let imgFailed = $state(false);
  let popover = $state(false);
  let bookmarkId = $state<number | null>(null);
  let saving = $state(false);
  let myNote = $state<Note | null>(null);
  let editing = $state(false);
  $effect(() => { bookmarkId = item.bookmarkId; });
  $effect(() => { myNote = item.myNote ?? null; });
  const source = $derived(item.feedTitle ?? hostOf(item.siteUrl ?? item.url));
  const others = $derived(item.notes ?? []);

  function opened() {
    api.event('item_opened', { itemId: item.id, feedId: item.feedId });
  }

  /** Save this post. Post-level, private, one set. Tap again to remove. */
  async function toggleBookmark() {
    if (saving) return;
    saving = true;
    try {
      if (bookmarkId) {
        const id = bookmarkId;
        bookmarkId = null;
        await bookmarksApi.remove(id);
        api.event('bookmark_removed', { itemId: item.id, via: 'card' });
      } else {
        const b = await bookmarksApi.saveItem(item.id);
        bookmarkId = b.id;
        api.event('bookmark_saved', { itemId: item.id, feedId: item.feedId, via: 'card' });
        showToast('Saved to Bookmarks');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    } finally {
      saving = false;
    }
  }

  /** The note button: no note yet opens the editor; a note already there opens it for editing. */
  function noteButton() {
    editing = !editing;
    if (editing) api.event('note_editor_opened', { itemId: item.id, existing: !!myNote });
  }

  function openSource() {
    api.event('source_opened', { feedId: item.feedId, via: 'card' });
    popover = true;
  }
</script>

<!--
  The card is about the POST. The source line at the top is the one feed-level
  thing on it, and tapping it opens the feed's profile rather than the post.
  The body is the link out; click out is the reading model. Notes (mine, then
  the ones I'm allowed to see) hang off the bottom.
-->
<article class="card">
  <header>
    {#if showSource}
      <button class="source" onclick={openSource} title="About {source}">
        <SourceIcon feedId={item.feedId} hasIcon={item.hasIcon} name={source} />
        <span class="name">{source}</span>
      </button>
      <span class="dot">·</span>
    {/if}
    <time datetime={item.publishedAt} title={new Date(item.publishedAt).toLocaleString()}>{relativeTime(item.publishedAt)}</time>
    <span class="spacer"></span>
    {#if session.user}
      <button class="act" class:on={!!myNote} onclick={noteButton} aria-pressed={!!myNote} aria-expanded={editing} aria-label={myNote ? 'Edit my note' : 'Add a note'} title={myNote ? 'My note' : 'Add a note'}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill={myNote ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H10l-5 4v-4H5.5A1.5 1.5 0 0 1 4 14.5z" /></svg>
      </button>
      <button class="act" class:on={!!bookmarkId} onclick={toggleBookmark} aria-pressed={!!bookmarkId} aria-label={bookmarkId ? 'Remove bookmark' : 'Bookmark this post'} title={bookmarkId ? 'Bookmarked' : 'Bookmark'}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill={bookmarkId ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 4h12v17l-6-4-6 4z" /></svg>
      </button>
    {/if}
  </header>
  <a class="link" href={item.url ?? item.siteUrl ?? '#'} target="_blank" rel="noopener" onclick={opened} onauxclick={opened}>
    {#if item.imageUrl && !imgFailed}
      <img class="hero" src={item.imageUrl} alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror={() => (imgFailed = true)} />
    {/if}
    <h2>{item.title ?? item.summary ?? item.url}</h2>
    {#if item.title && item.summary && item.summary !== item.title}
      <p>{item.summary}</p>
    {/if}
    {#if item.author}
      <footer>{item.author}</footer>
    {/if}
  </a>

  {#if editing}
    <NoteEditor itemId={item.id} note={myNote}
      onsaved={(n) => { myNote = n; editing = false; showToast(item.myNote ? 'Note updated' : 'Note saved'); item.myNote = n; }}
      ondeleted={() => { myNote = null; editing = false; item.myNote = null; }}
      oncancel={() => (editing = false)} />
  {:else if myNote}
    <NoteBlock note={myNote} mine onedit={() => (editing = true)} />
  {/if}
  {#each others as n (n.id)}
    <NoteBlock note={n} />
  {/each}
</article>

{#if popover}
  <FeedPopover feedId={item.feedId} onclose={() => (popover = false)} />
{/if}

<style>
  .card {
    background: var(--surface);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    overflow: hidden;
    transition: transform 120ms ease;
  }
  .card:active { transform: scale(0.99); }
  header {
    display: flex; align-items: center; gap: 8px;
    font-size: 13px; color: var(--text-2); padding: 10px 8px 0 16px; min-width: 0;
  }
  .source { display: flex; align-items: center; gap: 8px; min-width: 0; padding: 4px 6px 4px 0; border-radius: 8px; text-align: left; }
  .source:hover { background: var(--surface-2); }
  .name { font-weight: 600; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .dot { color: var(--text-3); }
  time { color: var(--text-3); white-space: nowrap; }
  .spacer { flex: 1; }
  .act { width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; color: var(--text-3); flex: none; }
  .act:hover { background: var(--surface-2); color: var(--accent); }
  .act.on { color: var(--accent); }
  .link { display: block; padding: 8px 16px 16px; -webkit-tap-highlight-color: transparent; }
  @media (hover: hover) { .link:hover h2 { text-decoration: underline; text-decoration-color: var(--text-3); text-underline-offset: 3px; } }
  .hero {
    width: calc(100% + 32px); margin: 0 -16px 12px; aspect-ratio: 16 / 9; object-fit: cover;
    background: var(--surface-2);
  }
  h2 {
    margin: 0; font-family: var(--font-serif); font-weight: 600;
    font-size: 21px; line-height: 1.25; letter-spacing: -0.01em; overflow-wrap: anywhere;
  }
  p {
    margin: 8px 0 0; color: var(--text-2); font-size: 15px;
    display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
  }
  footer { margin-top: 10px; font-size: 13px; color: var(--text-3); }
</style>
