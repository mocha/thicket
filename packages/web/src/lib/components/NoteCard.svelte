<script lang="ts">
  /**
   * A post on a notes page: the same compact shape as a saved post on the
   * Bookmarks page (source line, title, two lines of summary, a small
   * thumbnail), with the note itself underneath. Mine can be edited in place;
   * other people's are read. The body opens the post the way the reader
   * setting says, as on every other card.
   */
  import type { Note, RiverItem } from '$lib/api';
  import { api } from '$lib/api';
  import { hostOf, relativeTime } from '$lib/time';
  import { openReader, readsInline } from '$lib/reader.svelte';
  import { showToast } from '$lib/toast.svelte';
  import SourceIcon from './SourceIcon.svelte';
  import NoteBlock from './NoteBlock.svelte';
  import NoteEditor from './NoteEditor.svelte';

  let { item }: { item: RiverItem } = $props();
  let editing = $state(false);
  let imgFailed = $state(false);
  const source = $derived(item.feedTitle ?? hostOf(item.siteUrl ?? item.url));
  const others = $derived(item.notes ?? []);

  function opened(e: MouseEvent) {
    if (e.type === 'click' && readsInline() && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      openReader(item);
      return;
    }
    api.event('item_opened', { itemId: item.id, feedId: item.feedId, via: 'notes' });
  }
  function saved(n: Note) { showToast(item.myNote ? 'Note updated' : 'Note saved'); item.myNote = n; editing = false; }
</script>

<li class="nc">
  <div class="row">
    <a class="body" href={item.url ?? item.siteUrl ?? '#'} target="_blank" rel="noopener" onclick={opened} onauxclick={opened}>
      <div class="meta">
        <SourceIcon feedId={item.feedId} hasIcon={item.hasIcon} name={source} size={18} />
        <span class="site">{source}</span>
        <span class="dot">·</span><time datetime={item.publishedAt}>{relativeTime(item.publishedAt)}</time>
      </div>
      <h3>{item.title ?? item.summary ?? item.url}</h3>
      {#if item.title && item.summary && item.summary !== item.title}<p>{item.summary}</p>{/if}
    </a>
    {#if item.imageUrl && !imgFailed}<img class="thumb" src={item.imageUrl} alt="" loading="lazy" referrerpolicy="no-referrer" onerror={() => (imgFailed = true)} />{/if}
  </div>
  {#if editing}
    <NoteEditor itemId={item.id} note={item.myNote} onsaved={saved} ondeleted={() => { item.myNote = null; editing = false; }} oncancel={() => (editing = false)} />
  {:else if item.myNote}
    <NoteBlock note={item.myNote} mine onedit={() => (editing = true)} />
  {/if}
  {#each others as n (n.id)}
    <NoteBlock note={n} />
  {/each}
</li>

<style>
  .nc { background: var(--surface); border-radius: var(--radius); box-shadow: var(--shadow); border: var(--card-border, 0); list-style: none; overflow: hidden; }
  .row { display: flex; gap: 12px; padding: 12px 14px; }
  .body { flex: 1; min-width: 0; }
  .meta { display: flex; align-items: center; gap: 6px; font-size: calc(12px * var(--size-app)); color: var(--text-3); margin-bottom: 4px; min-width: 0; }
  .site { font-weight: 600; color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  time { white-space: nowrap; }
  h3 { margin: 0; font-family: var(--font-headings); font-size: calc(17px * var(--size-headings)); line-height: 1.3; font-weight: 600; overflow-wrap: anywhere; }
  @media (hover: hover) { .body:hover h3 { text-decoration: underline; text-decoration-color: var(--text-3); text-underline-offset: 3px; } }
  .body p { margin: 4px 0 0; font-family: var(--font-reading); font-size: calc(14px * var(--size-reading)); color: var(--text-2); display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .thumb { flex: none; width: 72px; height: 72px; object-fit: cover; border-radius: var(--radius-sm); background: var(--surface-2); align-self: center; }
</style>
