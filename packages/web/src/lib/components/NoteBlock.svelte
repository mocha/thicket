<script lang="ts">
  import Dot from '$lib/components/Dot.svelte';
  import Avatar from './Avatar.svelte';
  import Icon from './Icon.svelte';
  /**
   * One note under a post, mine or someone's, headed by who wrote it: their
   * picture, name and handle, with the date underneath (issue #239). Mine is
   * headed the same way, from the signed-in account, and has Edit note.
   * Shows three lines, then "Show more" slides the rest out.
   * Rendering is our own safe Markdown subset (lib/markdown.ts), where an
   * @mention of someone with an account links to their profile.
   *
   * On a searched list the caller passes `marked`: the note's text with the
   * matched words fenced (lib/words.ts). They are drawn highlighted, and if the
   * three lines would hide every one of them the note opens by itself.
   */
  import type { Note, PublicNote } from '$lib/api';
  import { profileHref } from '$lib/api';
  import { renderMarkdown } from '$lib/markdown';
  import { highlightHtml } from '$lib/words';
  import { relativeTime } from '$lib/time';
  import { session } from '$lib/session.svelte';

  let { note, mine = false, marked = null, onedit }: { note: Note | PublicNote; mine?: boolean; marked?: string | null; onedit?: () => void } = $props();
  let expanded = $state(false);
  let body = $state<HTMLElement | null>(null);
  let overflows = $state(false);
  const html = $derived(marked ? highlightHtml(renderMarkdown(marked, note.mentions)) : renderMarkdown(note.body, note.mentions));
  const edited = $derived(new Date(note.updatedAt).getTime() - new Date(note.createdAt).getTime() > 60_000);
  const author = $derived('author' in note ? note.author : null);
  /* Who wrote it. Mine comes from the signed-in account, which can be briefly
     unknown while the page loads; then the head shows just the date. A note
     that names its author (the design system's sample) falls back to that. */
  const who = $derived(mine ? (session.user ?? author) : author);

  // Only offer "Show more" when the clamped box is actually hiding something.
  $effect(() => {
    void html;
    if (!body || expanded) return;
    overflows = body.scrollHeight > body.clientHeight + 2;
    // A search matched only in the part the three lines hide: open the note so the match shows.
    if (overflows && marked) {
      const edge = body.getBoundingClientRect().bottom;
      const hits = [...body.querySelectorAll('mark')];
      if (hits.length && !hits.some((m) => m.getBoundingClientRect().top < edge)) expanded = true;
    }
  });
</script>

<div class="note">
  <div class="head">
    {#if who}
      <!-- The picture is a second way to tap through for a pointer; it's hidden from keyboards and screen readers, so they meet the name's link once. -->
      <a class="pic" href={profileHref(who.handle)} tabindex="-1" aria-hidden="true"><Avatar handle={who.handle} name={who.displayName ?? who.handle} size={32} v={who.avatarUpdatedAt ?? null} /></a>
    {/if}
    <div class="id">
      {#if who}
        <a class="who" href={profileHref(who.handle)}>{#if who.displayName}<span class="name">{who.displayName}</span> <span class="handle">(@{who.handle})</span>{:else}<span class="name">@{who.handle}</span>{/if}</a>
      {/if}
      <span class="when" title={new Date(note.createdAt).toLocaleString()}>{relativeTime(note.createdAt)}{#if edited}{' '}<Dot /> edited {relativeTime(note.updatedAt)}{/if}</span>
    </div>
    {#if mine && onedit}<button class="edit tap" onclick={onedit}><Icon name="pencil" size={16} />Edit note</button>{/if}
  </div>
  <div class="body" class:clamped={!expanded} bind:this={body}>{@html html}</div>
  {#if overflows || expanded}
    <button class="more tap" onclick={() => (expanded = !expanded)} aria-expanded={expanded}>{expanded ? 'Show less' : 'Show more'}</button>
  {/if}
</div>

<style>
  /* No fill of its own: a note is part of the post, so it takes whatever the
     post sits on, white in a card and the page on a post's own page (issue
     #170). The rule above sets it apart, held in from the card's sides so it
     reads as a break inside the post, not a new card; the writer's picture and
     name head it (issue #239). The inset is a margin, so the words line up with
     the post's own. */
  .note { border-top: 1px solid var(--line); margin: 0 var(--card-pad, var(--space-4)); padding: var(--space-3) 0; font-size: calc(var(--text-sm) * var(--size-app)); }
  .head { display: flex; align-items: center; gap: var(--space-2); margin-bottom: var(--space-2); }
  .pic { display: flex; flex: none; }
  .id { display: flex; flex-direction: column; flex: 1; min-width: 0; line-height: 1.35; }
  /* A long name and handle cut off at the end, so the handle goes first and Edit always fits. */
  .who { color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .name { font-weight: 600; }
  .handle { color: var(--text-2); }
  @media (hover: hover) { .who:hover .name { text-decoration: underline; text-underline-offset: 3px; } }
  .when { color: var(--text-2); }
  .edit { flex: none; display: inline-flex; align-items: center; gap: var(--space-1); font-size: calc(var(--text-sm) * var(--size-app)); font-weight: 600; color: var(--accent); }
  .body { color: var(--text); line-height: 1.5; overflow-wrap: anywhere; }
  .body.clamped { display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
  .body :global(p) { margin: 0 0 var(--space-2); }
  .body :global(p:last-child), .body :global(ul:last-child), .body :global(ol:last-child), .body :global(blockquote:last-child), .body :global(pre:last-child) { margin-bottom: 0; }
  .body :global(ul), .body :global(ol) { margin: 0 0 var(--space-2); padding-left: var(--space-5); }
  .body :global(blockquote) { margin: 0 0 var(--space-2); padding-left: var(--space-3); border-left: 3px solid var(--line); color: var(--text-2); }
  .body :global(code) { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.92em; /* The quiet shading, so code shows against the note, which has no fill of its own. */ background: var(--surface-2); /* 1px vertical is optical: inline code stays on the text's line. */ padding: 1px var(--space-1); border-radius: var(--radius-xs); }
  .body :global(pre) { margin: 0 0 var(--space-2); padding: var(--space-2) var(--space-3); background: var(--surface-2); border-radius: var(--radius-sm); overflow-x: auto; }
  .body :global(pre code) { background: none; padding: 0; }
  .body :global(a) { color: var(--accent); font-weight: 600; text-decoration: underline; text-decoration-color: color-mix(in srgb, var(--accent) 40%, transparent); }
  /* The words a search matched. The same highlight as a search result on Explore. */
  .body :global(mark) { background: color-mix(in srgb, var(--accent) 28%, transparent); color: inherit; border-radius: var(--radius-xs); padding: 0 1px; }
  .more { margin-top: var(--space-1); font-size: calc(var(--text-sm) * var(--size-app)); font-weight: 600; color: var(--text-2); }
  .more:hover { color: var(--accent); }
</style>
