<script lang="ts">
  import { noOrphan } from '$lib/orphans';
  /**
   * One saved post, mine or someone else's, with the note on it. The whole
   * body — words and thumbnail — links to the post, opening it here or in a
   * tab depending on the reader's setting, the same as every other card.
   *
   * A note is part of the bookmark (issue #84). On my own list (`mine`) the
   * corner has a note button beside the remove button, my note sits under the
   * post editable in place, and other people's notes I may read follow it. On
   * someone's profile their note shows under the post, read-only, and the one
   * action in the corner is whatever the page passes: save a copy, usually.
   */
  import type { Bookmark, Note, PublicBookmark, PublicUser, SavedNote } from '$lib/api';
  import { api, itemsApi } from '$lib/api';
  import { hostOf, relativeTime, savedHref, webHref } from '$lib/time';
  import { openReader, readsInline } from '$lib/reader.svelte';
  import { showToast } from '$lib/toast.svelte';
  import Card from './Card.svelte';
  import CardMeta from './CardMeta.svelte';
  import IconButton from './IconButton.svelte';
  import NoteBlock from './NoteBlock.svelte';
  import NoteEditor from './NoteEditor.svelte';

  let { b, mine = false, author = null, onopen, onnote, action }: {
    b: Bookmark | PublicBookmark;
    /** My own list: the note is mine to write, edit and delete. */
    mine?: boolean;
    /** Whose list this is, when it isn't mine, to name their note. */
    author?: Pick<PublicUser, 'handle' | 'displayName'> | null;
    onopen?: () => void;
    /** The note was written, edited or deleted here. `had`: whether there was one before. */
    onnote?: (note: Note | null, had: boolean) => void;
    action?: { label: string; title?: string; on: boolean; run: () => void; kind: 'remove' | 'save' };
  } = $props();

  let editing = $state(false);
  const site = $derived(b.siteTitle ?? hostOf(b.url));
  const others = $derived('notes' in b ? (b.notes ?? []) : []);
  const theirNote = $derived(!mine && b.note && author ? { ...b.note, author } : null);

  /**
   * A plain click opens the post here when that is the reader's setting and we
   * still know which post this was saved from; everything else — a bookmark
   * saved from a bare address, middle-click, long-press — follows the link
   * out. If fetching the post fails we open the tab ourselves, since the click
   * was already held back.
   */
  async function opened(e: MouseEvent) {
    const plain = e.type === 'click' && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
    if (plain && b.itemId !== null && readsInline()) {
      e.preventDefault();
      onopen?.();
      try {
        openReader(await itemsApi.get(b.itemId));
      } catch {
        const href = savedHref(b.url);
        if (href) window.open(href, '_blank', 'noopener');
      }
      return;
    }
    onopen?.();
  }

  function noteButton() {
    editing = !editing;
    if (editing) api.event('note_editor_opened', { bookmarkId: b.id, existing: !!b.note, via: 'bookmarks' });
  }

  function saved(n: SavedNote) {
    const had = !!b.note;
    showToast(had ? 'Note updated' : 'Note saved');
    const note: Note = { id: n.id, body: n.body, createdAt: n.createdAt, updatedAt: n.updatedAt };
    b.note = note;
    editing = false;
    onnote?.(note, had);
  }

  function deleted() {
    const had = !!b.note;
    b.note = null;
    editing = false;
    onnote?.(null, had);
  }
</script>

<Card as="li" class="bm" pad={false}>
  <a class="body" href={savedHref(b.url) ?? '#'} target="_blank" rel="noopener" onclick={opened} onauxclick={opened}>
    <div class="text" class:two={mine && action}>
      <CardMeta feedId={b.feedId} hasIcon={b.hasIcon} name={site} when={b.publishedAt} />
      <h3 class="card-title">{noOrphan(b.title ?? b.url)}</h3>
      {#if b.summary}<p class="card-summary">{b.summary}</p>{/if}
      <div class="saved">Saved <time datetime={b.savedAt} title={new Date(b.savedAt).toLocaleString()}>{relativeTime(b.savedAt)}</time></div>
    </div>
    {#if b.imageUrl}<img class="thumb" src={b.imageUrl} alt="" loading="lazy" referrerpolicy="no-referrer" onerror={(e) => ((e.currentTarget as HTMLImageElement).hidden = true)} />{/if}
  </a>
  {#if webHref(b.linkUrl) && b.linkLabel}
    <!-- The source post's discussion-style link (e.g. Hacker News's "Comments"), outside the body's own link. -->
    <a class="card-extralink" href={webHref(b.linkUrl)} target="_blank" rel="noopener">{b.linkLabel} →</a>
  {/if}
  <div class="corner">
    {#if mine}
      <IconButton icon="note" pressed={!!b.note} aria-expanded={editing} onclick={noteButton} label={b.note ? 'Edit my note' : 'Add a note'} title={b.note ? 'My note' : 'Add a note'} />
    {/if}
    {#if action}
      {#if action.kind === 'remove'}
        <IconButton class="remove" icon="close" onclick={action.run} label={action.label} title={action.title ?? action.label} />
      {:else}
        <IconButton icon="bookmark" pressed={action.on} onclick={action.run} label={action.label} title={action.title ?? action.label} />
      {/if}
    {/if}
  </div>
  {#if mine}
    {#if editing}
      <NoteEditor bookmarkId={b.id} note={b.note} onsaved={saved} ondeleted={deleted} oncancel={() => (editing = false)} />
    {:else if b.note}
      <NoteBlock note={b.note} mine onedit={() => (editing = true)} />
    {/if}
  {:else if theirNote}
    <NoteBlock note={theirNote} />
  {/if}
  {#each others as n (n.id)}
    <NoteBlock note={n} />
  {/each}
</Card>

<style>
  .body { display: flex; gap: var(--space-3); align-items: center; padding: var(--card-pad); }
  .text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: var(--space-1); padding-right: var(--space-6); }
  /* Room for two corner buttons: the note, then remove. */
  .text.two { padding-right: calc(var(--space-6) * 2); }
  @media (hover: hover) { .body:hover h3 { text-decoration: underline; text-decoration-color: var(--text-3); text-underline-offset: 3px; } }
  p { --summary-lines: 2; }
  .saved { font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-3); }
  .card-extralink { display: inline-block; margin: calc(-1 * var(--space-2)) var(--card-pad) var(--space-3); font-size: calc(var(--text-sm) * var(--size-app)); font-weight: 600; color: var(--accent); }
  @media (hover: hover) { .card-extralink:hover { text-decoration: underline; text-underline-offset: 3px; } }
  .thumb { flex: none; width: 72px; height: 72px; object-fit: cover; border-radius: var(--radius-sm); background: var(--surface-2); }
  /* The actions sit in the card's top corner, over the body's padding. */
  .corner { position: absolute; top: var(--space-2); right: var(--space-2); display: flex; gap: var(--space-1); }
  /* Taking a bookmark away is the one destructive thing here, so it hovers red. */
  .corner :global(button.remove):hover { color: var(--danger); }
</style>
