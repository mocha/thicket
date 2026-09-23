<script lang="ts">
  import { noOrphan } from '$lib/orphans';
  import type { Note, RiverItem } from '$lib/api';
  import { api } from '$lib/api';
  import { relativeTime, hostOf } from '$lib/time';
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
   * `fresh`: newer than the point where this reader last stopped in this list ("What's new", on for this device). A small mark by the time.
   */
  let { item, showSource = true, compact = false, fresh = false }: { item: RiverItem; showSource?: boolean; compact?: boolean; fresh?: boolean } = $props();
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
</script>

<!--
  The card is about the POST. The source line at the top is the one feed-level
  thing on it, and tapping it opens the feed's profile rather than the post.
  The body is the link out, or opens the reader for those who read here. Notes (mine, then
  the ones I'm allowed to see) hang off the bottom.
-->
<Card {compact} pad={false}>
  <header class:compact>
    {#if showSource}
      <CardMeta feedId={item.feedId} hasIcon={item.hasIcon} name={source} when={item.publishedAt} onsource={openSource}>
        {#if fresh}<span class="fresh" title="Newer than where you last stopped in this list">New</span>{/if}
      </CardMeta>
    {:else}
      <time datetime={item.publishedAt} title={new Date(item.publishedAt).toLocaleString()}>{relativeTime(item.publishedAt)}</time>
      {#if fresh}<span class="fresh" title="Newer than where you last stopped in this list">New</span>{/if}
    {/if}
    <span class="spacer"></span>
    {#if session.user}
      <ItemActions {item} noteOpen={editing} onnote={noteButton} via="card" />
    {/if}
  </header>
  <a class="link" class:compact href={item.url ?? item.siteUrl ?? '#'} target="_blank" rel="noopener" onclick={opened} onauxclick={opened}>
    {#if item.imageUrl && !imgFailed}
      <img class="hero" src={item.imageUrl} alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror={() => (imgFailed = true)} />
    {/if}
    <h2 class="card-title" class:tight={compact}>{noOrphan(item.title ?? item.summary ?? item.url)}</h2>
    {#if item.title && item.summary && item.summary !== item.title}
      <p class="card-summary" class:tight={compact}>{item.summary}</p>
    {/if}
    {#if item.author}
      <footer>{item.author}</footer>
    {/if}
  </a>

  {#if item.linkUrl && item.linkLabel && !compact}
    <!-- The feed's whole description was a link elsewhere (e.g. Hacker News's
         discussion thread). It lives outside the body's link, since a link can't
         nest inside another. -->
    <a class="card-extralink" href={item.linkUrl} target="_blank" rel="noopener">{item.linkLabel} →</a>
  {/if}

  {#if compact && (myNote || others.length)}
    <span class="notecount">{(myNote ? 1 : 0) + others.length} {(myNote ? 1 : 0) + others.length === 1 ? 'note' : 'notes'}</span>
  {/if}

  {#if item.repeatOf?.length && !compact}
    <div class="repeat">
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 2l4 4-4 4" /><path d="M3 11v-1a4 4 0 0 1 4-4h14" /><path d="M7 22l-4-4 4-4" /><path d="M21 13v1a4 4 0 0 1-4 4H3" /></svg>
      <span>This post appears to be a repeat of earlier {item.repeatOf.length === 1 ? 'post' : 'posts'} from {#each item.repeatOf as r, i (r.id)}{i > 0 ? ', ' : ''}<a href={r.url ?? item.siteUrl ?? '#'} target="_blank" rel="noopener" title={r.title ?? ''}>{new Date(r.publishedAt).toLocaleDateString('sv-SE')}</a>{/each}.</span>
    </div>
  {/if}

  {#if !compact}
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
  time { color: var(--text-3); white-space: nowrap; }
  .fresh { font-size: calc(var(--text-xs) * var(--size-app)); font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--accent); }
  .spacer { flex: 1; }
  .link { display: block; padding: var(--space-2) var(--card-pad) var(--card-pad); -webkit-tap-highlight-color: transparent; }
  @media (hover: hover) { .link:hover h2 { text-decoration: underline; text-decoration-color: var(--text-3); text-underline-offset: 3px; } }
  .hero {
    width: calc(100% + var(--card-pad) * 2); margin: 0 calc(var(--card-pad) * -1) var(--space-3); aspect-ratio: 16 / 9; object-fit: cover;
    background: var(--surface-2);
  }
  footer { margin-top: var(--space-3); font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-3); }
  .card-extralink { display: inline-block; margin: calc(-1 * var(--space-2)) var(--card-pad) var(--card-pad); font-size: calc(var(--text-sm) * var(--size-app)); font-weight: 600; color: var(--accent); }
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
  h2.tight { grid-column: 1; font-size: calc(var(--text-base) * var(--size-headings)); --title-lines: 2; }
  p.tight { grid-column: 1; --summary-gap: var(--space-1); font-size: calc(var(--text-sm) * var(--size-reading)); --summary-lines: 2; }
  .link.compact footer { grid-column: 1; margin-top: var(--space-1); font-size: calc(var(--text-sm) * var(--size-app)); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .notecount { position: absolute; right: var(--card-pad); bottom: var(--space-2); font-size: calc(var(--text-xs) * var(--size-app)); font-weight: 600; color: var(--accent); }
</style>
