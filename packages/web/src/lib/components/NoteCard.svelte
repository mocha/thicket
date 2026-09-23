<script lang="ts">
  import { noOrphan } from '$lib/orphans';
  /**
   * A post on a notes page: the same shape as a saved post on the Bookmarks
   * page (source line, title, two lines of summary, a small thumbnail), with
   * the note itself underneath. Mine can be edited in place; other people's
   * are read. The body opens the post the way the reader setting says, as on
   * every other card.
   */
  import type { Note, RiverItem } from '$lib/api';
  import { api } from '$lib/api';
  import { hostOf, webHref } from '$lib/time';
  import { openReader, readsInline } from '$lib/reader.svelte';
  import { showToast } from '$lib/toast.svelte';
  import Card from './Card.svelte';
  import CardMeta from './CardMeta.svelte';
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

<Card as="li" pad={false}>
  <a class="body" href={webHref(item.url) ?? webHref(item.siteUrl) ?? '#'} target="_blank" rel="noopener" onclick={opened} onauxclick={opened}>
    <div class="text">
      <CardMeta feedId={item.feedId} hasIcon={item.hasIcon} name={source} when={item.publishedAt} />
      <h3 class="card-title">{noOrphan(item.title ?? item.summary ?? item.url)}</h3>
      {#if item.title && item.summary && item.summary !== item.title}<p class="card-summary">{item.summary}</p>{/if}
    </div>
    {#if item.imageUrl && !imgFailed}<img class="thumb" src={item.imageUrl} alt="" loading="lazy" referrerpolicy="no-referrer" onerror={() => (imgFailed = true)} />{/if}
  </a>
  {#if webHref(item.linkUrl) && item.linkLabel}
    <!-- The source post's discussion-style link (e.g. Hacker News's "Comments"), outside the body's own link. -->
    <a class="card-extralink" href={webHref(item.linkUrl)} target="_blank" rel="noopener">{item.linkLabel} →</a>
  {/if}
  {#if editing}
    <NoteEditor itemId={item.id} note={item.myNote} onsaved={saved} ondeleted={() => { item.myNote = null; editing = false; }} oncancel={() => (editing = false)} />
  {:else if item.myNote}
    <NoteBlock note={item.myNote} mine onedit={() => (editing = true)} />
  {/if}
  {#each others as n (n.id)}
    <NoteBlock note={n} />
  {/each}
</Card>

<style>
  .body { display: flex; gap: var(--space-3); align-items: center; padding: var(--card-pad); }
  .text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: var(--space-1); }
  @media (hover: hover) { .body:hover h3 { text-decoration: underline; text-decoration-color: var(--text-3); text-underline-offset: 3px; } }
  p { --summary-lines: 2; }
  .card-extralink { display: inline-block; margin: calc(-1 * var(--space-2)) var(--card-pad) var(--space-3); font-size: calc(var(--text-sm) * var(--size-app)); font-weight: 600; color: var(--accent); }
  @media (hover: hover) { .card-extralink:hover { text-decoration: underline; text-underline-offset: 3px; } }
  .thumb { flex: none; width: 72px; height: 72px; object-fit: cover; border-radius: var(--radius-sm); background: var(--surface-2); }
</style>
