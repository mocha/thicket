<script lang="ts">
  import { noOrphan } from '$lib/orphans';
  import type { Note, RiverItem } from '$lib/api';
  import { api } from '$lib/api';
  import { noteToast } from '$lib/saves';
  import { hostOf, webHref } from '$lib/time';
  import { session } from '$lib/session.svelte';
  import Card from './Card.svelte';
  import CardMeta from './CardMeta.svelte';
  import FeedPopover from './FeedPopover.svelte';
  import NoteBlock from './NoteBlock.svelte';
  import NoteEditor from './NoteEditor.svelte';
  import ItemActions from './ItemActions.svelte';
  import { openReader, readsInline } from '$lib/reader.svelte';
  import { showToast } from '$lib/toast.svelte';

  /**
   * `compact`: the paged layout's fixed-height card. Thumbnail beside the text, two lines each, notes counted rather than shown.
   * `linkSource`: the feed name at the top opens the feed's card. Off on the feed's own page, where it is plain text.
   * `fresh`: newer than the point where this reader last stopped in this list ("What's new", on for this device). A small mark by the time.
   */
  let { item, linkSource = true, compact = false, fresh = false }: { item: RiverItem; linkSource?: boolean; compact?: boolean; fresh?: boolean } = $props();
  let imgFailed = $state(false);
  let popover = $state(false);
  let myNote = $state<Note | null>(null);
  let editing = $state(false);
  $effect(() => { myNote = item.myNote ?? null; });
  const source = $derived(item.feedTitle ?? hostOf(item.siteUrl ?? item.url));
  const others = $derived(item.notes ?? []);

  /** The body is a real link to the post. In-app readers intercept a plain click; middle-click and long-press still get the tab. */
  function opened(e: MouseEvent) {
    if (e.type === 'click' && readsInline() && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      openReader(item);
      return;
    }
    api.event('item_opened', { itemId: item.id, feedId: item.feedId });
  }

  /** The note button: no note yet opens the editor; a note already there opens it for editing. A compact card has no room, so the reader does it. */
  function noteButton() {
    if (compact) { openReader(item, { note: true }); return; }
    editing = !editing;
    if (editing) api.event('note_editor_opened', { itemId: item.id, existing: !!myNote });
  }

  function openSource() {
    api.event('source_opened', { feedId: item.feedId, via: 'card' });
    popover = true;
  }

  /**
   * A compact card is a fixed height, so its summary gets whatever room the
   * title and byline leave, which is rarely a whole number of lines. This
   * shows only as many lines as fit whole (none, if there isn't room for
   * one), so the last line is never sliced through the middle.
   */
  function wholeLines(node: HTMLElement, on: boolean) {
    if (!on) return;
    const fit = () => {
      const lh = Number.parseFloat(getComputedStyle(node).lineHeight);
      if (!lh) return;
      // Measure the room with the paragraph's own caps off (it then takes all
      // the height the card can give it), then cap it to whole lines: cutting the text at a line count alone would still let
      // the next line show in whatever space was left over.
      node.style.maxHeight = '';
      node.style.setProperty('--summary-lines', '9');
      const lines = Math.floor((node.clientHeight + 1) / lh);
      node.style.setProperty('--summary-lines', String(Math.max(1, lines)));
      node.style.maxHeight = `${Math.max(1, lines) * lh}px`;
      node.style.visibility = lines < 1 ? 'hidden' : '';
    };
    const ro = new ResizeObserver(fit);
    ro.observe(node);
    fit();
    return { destroy: () => ro.disconnect() };
  }
</script>

<!--
  The card is about the POST. The source line at the top is the one feed-level
  thing on it, and tapping it opens the feed's profile rather than the post.
  The body is the link out, or opens the reader for those who read here. Notes (mine, then
  the ones I'm allowed to see) hang off the bottom.
-->
<Card {compact} pad={false}>
  <header class:compact>
    <!-- On the feed's own page the name stays, so a card still says where it's from, but as plain text: it would only open the page you're on. -->
    <CardMeta feedId={item.feedId} hasIcon={item.hasIcon} name={source} when={item.publishedAt} onsource={linkSource ? openSource : undefined}>
      {#if fresh}<span class="fresh" title="Newer than where you last stopped in this list">New</span>{/if}
    </CardMeta>
    <span class="spacer"></span>
    {#if session.user}
      <ItemActions {item} noteOpen={editing} onnote={noteButton} via="card" />
    {/if}
  </header>
  <a class="link" class:compact href={webHref(item.url) ?? webHref(item.siteUrl) ?? '#'} target="_blank" rel="noopener" onclick={opened} onauxclick={opened}>
    {#if item.imageUrl && !imgFailed}
      <img class="hero" src={item.imageUrl} alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror={() => (imgFailed = true)} />
    {/if}
    <h3 class="card-title" class:tight={compact}>{noOrphan(item.title ?? item.summary ?? item.url)}</h3>
    {#if item.title && item.summary && item.summary !== item.title}
      <p class="card-summary" class:tight={compact} use:wholeLines={compact}>{item.summary}</p>
    {/if}
    {#if item.author}
      <footer>{item.author}</footer>
    {/if}
  </a>

  {#if webHref(item.linkUrl) && item.linkLabel}
    <!-- The feed's whole description was a link elsewhere (e.g. Hacker News's
         discussion thread). It lives outside the body's link, since a link can't
         nest inside another. -->
    <a class="card-extralink tap" class:compact href={webHref(item.linkUrl)} target="_blank" rel="noopener">{item.linkLabel} →</a>
  {/if}

  {#if compact && (myNote || others.length)}
    <span class="notecount">{(myNote ? 1 : 0) + others.length} {(myNote ? 1 : 0) + others.length === 1 ? 'note' : 'notes'}</span>
  {/if}

  {#if item.repeatOf?.length && !compact}
    <div class="repeat">
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 2l4 4-4 4" /><path d="M3 11v-1a4 4 0 0 1 4-4h14" /><path d="M7 22l-4-4 4-4" /><path d="M21 13v1a4 4 0 0 1-4 4H3" /></svg>
      <span>This post appears to be a repeat of earlier {item.repeatOf.length === 1 ? 'post' : 'posts'} from {#each item.repeatOf as r, i (r.id)}{i > 0 ? ', ' : ''}<a href={webHref(r.url) ?? webHref(item.siteUrl) ?? '#'} target="_blank" rel="noopener" title={r.title ?? ''}>{new Date(r.publishedAt).toLocaleDateString('sv-SE')}</a>{/each}.</span>
    </div>
  {/if}

  {#if !compact}
    {#if editing}
      <NoteEditor itemId={item.id} note={myNote}
      onsaved={(n) => { myNote = n; editing = false; showToast(noteToast(item)); item.myNote = n; item.bookmarkId = n.bookmarkId; }}
      ondeleted={() => { myNote = null; editing = false; item.myNote = null; }}
      oncancel={() => (editing = false)} />
    {:else if myNote}
      <NoteBlock note={myNote} mine onedit={() => (editing = true)} />
    {/if}
    {#each others as n (n.id)}
      <NoteBlock note={n} />
    {/each}
  {/if}
</Card>

{#if popover}
  <FeedPopover feedId={item.feedId} onclose={() => (popover = false)} />
{/if}

<style>
  header {
    display: flex; align-items: center; gap: var(--space-2);
    font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2);
    padding: var(--space-3) var(--space-2) 0 var(--card-pad); min-width: 0;
  }
  header.compact { padding-top: var(--space-2); }
  .fresh { font-size: calc(var(--text-xs) * var(--size-app)); font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--accent); }
  .spacer { flex: 1; }
  .link { display: block; padding: var(--space-2) var(--card-pad) var(--card-pad); -webkit-tap-highlight-color: transparent; }
  @media (hover: hover) { .link:hover h3 { text-decoration: underline; text-decoration-color: var(--text-3); text-underline-offset: 3px; } }
  /* Edge to edge: wider than the text by the card's inset on each side. The app-wide
     "never wider than your container" rule for pictures would cut it short on the right. */
  .hero {
    width: calc(100% + var(--card-pad) * 2); max-width: none; margin: 0 calc(var(--card-pad) * -1) var(--space-3); aspect-ratio: 16 / 9; object-fit: cover;
    background: var(--surface-2);
  }
  footer { margin-top: var(--space-3); font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); }
  .card-extralink { display: inline-block; margin: calc(-1 * var(--space-2)) var(--card-pad) var(--card-pad); font-size: calc(var(--text-sm) * var(--size-app)); font-weight: 600; color: var(--accent); }
  /* Compact cards fill a fixed frame; the link sits at the bottom edge with no negative pull. */
  .card-extralink.compact { margin: 0 var(--card-pad) var(--space-2); }
  @media (hover: hover) { .card-extralink:hover { text-decoration: underline; text-underline-offset: 3px; } }
  .repeat {
    display: flex; gap: var(--space-2); align-items: flex-start; margin: calc(-1 * var(--space-1)) var(--card-pad) var(--space-4); padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm); font-size: calc(var(--text-sm) * var(--size-app)); line-height: 1.4; color: var(--text-2);
    background: color-mix(in srgb, var(--amber) 12%, var(--surface));
  }
  /* The 1px here and below are optical nudges, not spacing. */
  .repeat svg { flex: none; margin-top: 1px; color: color-mix(in srgb, var(--amber) 78%, var(--text)); }
  .repeat a { color: var(--accent); font-weight: 600; font-variant-numeric: tabular-nums; }

  /* Compact: a fixed height so a page of cards lines up. The picture sits beside the words. */
  .link.compact { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) auto; grid-template-rows: auto 1fr auto; column-gap: var(--space-3); padding: var(--space-2) var(--card-pad); }
  .link.compact .hero { grid-column: 2; grid-row: 1 / span 3; width: 108px; height: 100%; max-height: 92px; aspect-ratio: auto; margin: 0; border-radius: var(--radius-sm); align-self: start; }
  h3.tight { grid-column: 1; font-size: calc(var(--text-base) * var(--size-headings)); --title-lines: 2; }
  /* The summary gets whatever room the title leaves, rounded down to whole lines, so a line is never sliced through the middle. */
  p.tight { grid-column: 1; --summary-gap: var(--space-1); font-size: calc(var(--text-sm) * var(--size-reading)); --summary-lines: 2; align-self: start; max-height: round(down, 100%, 1lh); }
  .link.compact footer { grid-column: 1; margin-top: var(--space-1); font-size: calc(var(--text-sm) * var(--size-app)); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .notecount { position: absolute; right: var(--card-pad); bottom: var(--space-2); font-size: calc(var(--text-xs) * var(--size-app)); font-weight: 600; color: var(--accent); }
</style>
