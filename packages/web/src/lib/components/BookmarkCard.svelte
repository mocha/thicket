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
   *
   * On a searched list the bookmark says where the search matched (`marks`),
   * and those words are highlighted in the title, the site name, the summary
   * and my note.
   *
   * The source line sits above the body's link, as on the article card, and
   * opens the feed's card rather than the post.
   */
  import type { Bookmark, Note, PublicBookmark, PublicUser, SavedNote } from '$lib/api';
  import { api, itemsApi, profileHref } from '$lib/api';
  import { hostOf, relativeTime, savedHref, ugcRel, webHref } from '$lib/time';
  import { openReader, readsInline } from '$lib/reader.svelte';
  import { showToast } from '$lib/toast.svelte';
  import { startsMidway } from '$lib/words';
  import Badge from './Badge.svelte';
  import Card from './Card.svelte';
  import CardMeta from './CardMeta.svelte';
  import CardFooter from './CardFooter.svelte';
  import Marked from './Marked.svelte';
  import FeedPopover from './FeedPopover.svelte';
  import IconButton from './IconButton.svelte';
  import NoteBlock from './NoteBlock.svelte';
  import NoteEditor from './NoteEditor.svelte';
  import { isPixel } from '$lib/pixel';

  /*
   * `fresh`: new since I last looked, the same small New as on an article card.
   * `saver`: say whose bookmark it is in the bottom row ("Bookmarked by Priya
   * Nair"), for a list where it isn't plain from the page (Notifications).
   */
  let { b, mine = false, author = null, onopen, onnote, action, heading = 'h3', flat = false, fresh = false, saver = false }: {
    b: Bookmark | PublicBookmark;
    /** My own list: the note is mine to write, edit and delete. */
    mine?: boolean;
    /** Whose list this is, when it isn't mine, to name their note. */
    author?: Pick<PublicUser, 'handle' | 'displayName' | 'avatarUpdatedAt'> | null;
    onopen?: () => void;
    /** The note was written, edited or deleted here. `had`: whether there was one before. */
    onnote?: (note: Note | null, had: boolean) => void;
    action?: { label: string; title?: string; on: boolean; run: () => void; kind: 'remove' | 'save' };
    /** The title's heading level: h3 under a section heading (a profile), h2 straight under the page title. */
    heading?: 'h2' | 'h3';
    /**
     * Drawn without a card of its own, as part of a row on a list card (a
     * mention on Notifications): the same content, edge to edge in the row, so
     * its text lines up with the rows around it and only the list card has an
     * edge and a shadow. Its title and summary take the list card's text rules.
     */
    flat?: boolean;
    fresh?: boolean;
    saver?: boolean;
  } = $props();

  let editing = $state(false);
  let popover = $state(false);
  const site = $derived(b.siteTitle ?? hostOf(b.url));
  const others = $derived('notes' in b ? (b.notes ?? []) : []);
  const theirNote = $derived(!mine && b.note && author ? { ...b.note, author } : null);
  const marks = $derived('marks' in b ? (b.marks ?? null) : null);
  /* The matched summary is the part around the match; say so when it starts mid-way. */
  const cut = $derived(!!marks?.summary && startsMidway(b.summary, marks.summary));
  /** The note changed under the search, so its old highlight no longer describes it. */
  function forgetNoteMark() {
    if ('marks' in b && b.marks) b.marks.note = null;
  }

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

  function openSource() {
    api.event('source_opened', { feedId: b.feedId, via: 'bookmark' });
    popover = true;
  }

  function noteButton() {
    editing = !editing;
    if (editing) api.event('note_editor_opened', { bookmarkId: b.id, existing: !!b.note, via: 'bookmarks' });
  }

  function saved(n: SavedNote) {
    const had = !!b.note;
    showToast(had ? 'Note updated' : 'Note saved');
    const note: Note = { id: n.id, body: n.body, createdAt: n.createdAt, updatedAt: n.updatedAt, mentions: n.mentions };
    b.note = note;
    forgetNoteMark();
    editing = false;
    onnote?.(note, had);
  }

  function deleted() {
    const had = !!b.note;
    b.note = null;
    forgetNoteMark();
    editing = false;
    onnote?.(null, had);
  }
</script>

{#snippet content()}
  <header>
    {#if marks?.site}
      <CardMeta feedId={b.feedId} hasIcon={b.hasIcon} name={site} when={b.publishedAt} onsource={openSource}>
        {#snippet label()}<Marked text={marks.site ?? ''} />{/snippet}
      </CardMeta>
    {:else}
      <CardMeta feedId={b.feedId} hasIcon={b.hasIcon} name={site} when={b.publishedAt} onsource={openSource}>
        {#if fresh}<Badge tone="soft" title="New since you last looked">New</Badge>{/if}
      </CardMeta>
    {/if}
  </header>
  <a class="body" href={savedHref(b.url) ?? '#'} target="_blank" rel={ugcRel(savedHref(b.url))} onclick={opened} onauxclick={opened}>
    <div class="text">
      <svelte:element this={heading} class="card-title">{#if marks?.title}<Marked text={noOrphan(marks.title)} />{:else}{noOrphan(b.title ?? b.url)}{/if}</svelte:element>
      {#if marks?.summary}<p class="card-summary found">{#if cut}… {/if}<Marked text={marks.summary} /></p>
      {:else if b.summary}<p class="card-summary">{b.summary}</p>{/if}
    </div>
    {#if b.imageUrl}<img class="thumb" src={b.imageUrl} alt="" loading="lazy" referrerpolicy="no-referrer" onload={(e) => ((e.currentTarget as HTMLImageElement).hidden = isPixel(e))} onerror={(e) => ((e.currentTarget as HTMLImageElement).hidden = true)} />{/if}
  </a>
  {#if webHref(b.linkUrl) && b.linkLabel}
    <!-- The source post's discussion-style link (e.g. Hacker News's "Comments"), outside the body's own link. -->
    <a class="card-extralink tap" href={webHref(b.linkUrl)} target="_blank" rel={ugcRel(b.linkUrl)}>{b.linkLabel} →</a>
  {/if}
  <!-- The bottom row: when it was saved on the left, what you can do on the right. -->
  <CardFooter>
    <span class="saved">Bookmarked {#if saver && author}by <a class="saver" href={profileHref(author.handle)}>{author.displayName ?? `@${author.handle}`}</a>{' '}{/if}<time datetime={b.savedAt} title={new Date(b.savedAt).toLocaleString()}>{relativeTime(b.savedAt)}</time></span>
    {#snippet actions()}
      <span class="buttons">
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
      </span>
    {/snippet}
  </CardFooter>
  {#if mine}
    {#if editing}
      <NoteEditor bookmarkId={b.id} note={b.note} onsaved={saved} ondeleted={deleted} oncancel={() => (editing = false)} />
    {:else if b.note}
      <NoteBlock note={b.note} mine marked={marks?.note} onedit={() => (editing = true)} />
    {/if}
  {:else if theirNote}
    <NoteBlock note={theirNote} />
  {/if}
  {#each others as n (n.id)}
    <NoteBlock note={n} />
  {/each}
  <!-- Inside the card: the list around it may only hold cards. -->
  {#if popover}
    <FeedPopover feedId={b.feedId} hasIcon={b.hasIcon} name={site} onclose={() => (popover = false)} />
  {/if}
{/snippet}

{#if flat}
  <div class="bm flat">{@render content()}</div>
{:else}
  <Card as="li" class="bm" pad={false}>{@render content()}</Card>
{/if}

<style>
  /* Whose bookmark: their name, dark like a byline, linking to their profile. */
  .saver { color: var(--text); font-weight: 600; }
  @media (hover: hover) { .saver:hover { text-decoration: underline; text-underline-offset: 3px; } }
  /* Flat: a row's room above is already there, so the source line sits close under the row's own line. */
  .flat header { padding-top: var(--space-2); }
  /* Inside a row the picture can't run to the list card's edges, so it keeps to the text's edges, with rounded corners. */
  .flat .thumb { width: 100%; margin: 0 0 var(--space-3); border-radius: var(--radius-sm); }
  header { padding: var(--card-pad) var(--card-pad) 0; }
  .body { display: flex; flex-direction: column; padding: var(--space-2) var(--card-pad) var(--space-2); }
  .text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: var(--space-1); }
  @media (hover: hover) { .body:hover :global(.card-title) { text-decoration: underline; text-decoration-color: var(--text-3); text-underline-offset: 3px; } }
  p { --summary-lines: 2; }
  /* The part of the summary a search matched gets a third line, so the match is not the bit cut off. */
  p.found { --summary-lines: 3; }
  /* A little room between the note button and the one beside it. */
  .buttons { display: flex; gap: var(--space-1); }
  .card-extralink { display: inline-block; margin: 0 var(--card-pad) var(--space-1); font-size: calc(var(--text-sm) * var(--size-app)); font-weight: 600; color: var(--accent); }
  @media (hover: hover) { .card-extralink:hover { text-decoration: underline; text-underline-offset: 3px; } }
  /* The same picture as the article card: edge to edge across the top, wider than the text by the card's inset on each side. */
  .thumb { order: -1; width: calc(100% + var(--card-pad) * 2); max-width: none; margin: 0 calc(var(--card-pad) * -1) var(--space-3); aspect-ratio: 16 / 9; object-fit: cover; background: var(--surface-2); }
  /* Taking a bookmark away is the one destructive thing here, so it hovers red. */
  .buttons :global(button.remove):hover { color: var(--danger); }
</style>
