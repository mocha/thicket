<script lang="ts">
  import type { Note, RiverItem } from '$lib/api';
  import { api } from '$lib/api';
  import { relativeTime, hostOf } from '$lib/time';
  import { session } from '$lib/session.svelte';
  import SourceIcon from './SourceIcon.svelte';
  import FeedPopover from './FeedPopover.svelte';
  import NoteBlock from './NoteBlock.svelte';
  import NoteEditor from './NoteEditor.svelte';
  import ItemActions from './ItemActions.svelte';
  import { openReader, readsInline } from '$lib/reader.svelte';
  import { showToast } from '$lib/toast.svelte';

  let { item, showSource = true }: { item: RiverItem; showSource?: boolean } = $props();
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
  The body is the link out, or opens the reader for those who read here. Notes (mine, then
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
      <ItemActions {item} noteOpen={editing} onnote={noteButton} via="card" />
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

  {#if item.repeatOf?.length}
    <div class="repeat">
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 2l4 4-4 4" /><path d="M3 11v-1a4 4 0 0 1 4-4h14" /><path d="M7 22l-4-4 4-4" /><path d="M21 13v1a4 4 0 0 1-4 4H3" /></svg>
      <span>This post appears to be a repeat of earlier {item.repeatOf.length === 1 ? 'post' : 'posts'} from {#each item.repeatOf as r, i (r.id)}{i > 0 ? ', ' : ''}<a href={r.url ?? item.siteUrl ?? '#'} target="_blank" rel="noopener" title={r.title ?? ''}>{new Date(r.publishedAt).toLocaleDateString('sv-SE')}</a>{/each}.</span>
    </div>
  {/if}

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
    border: var(--card-border, 0);
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
  .link { display: block; padding: 8px 16px 16px; -webkit-tap-highlight-color: transparent; }
  @media (hover: hover) { .link:hover h2 { text-decoration: underline; text-decoration-color: var(--text-3); text-underline-offset: 3px; } }
  .hero {
    width: calc(100% + 32px); margin: 0 -16px 12px; aspect-ratio: 16 / 9; object-fit: cover;
    background: var(--surface-2);
  }
  h2 {
    margin: 0; font-family: var(--font-headings); font-weight: 600;
    font-size: calc(21px * var(--size-headings)); line-height: 1.25; letter-spacing: -0.01em; overflow-wrap: anywhere;
  }
  p {
    margin: 8px 0 0; color: var(--text-2); font-family: var(--font-reading); font-size: calc(15px * var(--size-reading));
    display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
  }
  footer { margin-top: 10px; font-size: 13px; color: var(--text-3); }
  .repeat {
    display: flex; gap: 8px; align-items: flex-start; margin: -4px 16px 14px; padding: 8px 10px;
    border-radius: 10px; font-size: 13px; line-height: 1.4; color: var(--text-2);
    background: color-mix(in srgb, #c7861a 12%, var(--surface));
  }
  .repeat svg { flex: none; margin-top: 1px; color: color-mix(in srgb, #c7861a 78%, var(--text)); }
  .repeat a { color: var(--accent); font-weight: 600; font-variant-numeric: tabular-nums; }
</style>
