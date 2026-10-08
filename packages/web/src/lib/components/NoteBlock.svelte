<script lang="ts">
  import Dot from '$lib/components/Dot.svelte';
  /**
   * One note under a post: mine ("My note:") or someone's ("@bob's note:").
   * Shows three lines, then "Show more" slides the rest out. Mine has Edit.
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

  let { note, mine = false, marked = null, onedit }: { note: Note | PublicNote; mine?: boolean; marked?: string | null; onedit?: () => void } = $props();
  let expanded = $state(false);
  let body = $state<HTMLElement | null>(null);
  let overflows = $state(false);
  const html = $derived(marked ? highlightHtml(renderMarkdown(marked, note.mentions)) : renderMarkdown(note.body, note.mentions));
  const edited = $derived(new Date(note.updatedAt).getTime() - new Date(note.createdAt).getTime() > 60_000);
  const author = $derived('author' in note ? note.author : null);

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
    <span class="who">
      {#if mine}My note{:else if author}<a href={profileHref(author.handle)}>{author.displayName ?? `@${author.handle}`}</a>’s note{/if}
    </span>
    {#if mine || author}<Dot />{/if}
    <span class="when" title={new Date(note.createdAt).toLocaleString()}>{relativeTime(note.createdAt)}{#if edited} <Dot /> edited {relativeTime(note.updatedAt)}{/if}</span>
    {#if mine && onedit}<button class="edit tap" onclick={onedit}>Edit</button>{/if}
  </div>
  <div class="body" class:clamped={!expanded} bind:this={body}>{@html html}</div>
  {#if overflows || expanded}
    <button class="more tap" onclick={() => (expanded = !expanded)} aria-expanded={expanded}>{expanded ? 'Show less' : 'Show more'}</button>
  {/if}
</div>

<style>
  /* No fill of its own: a note is part of the post, so it takes whatever the
     post sits on, white in a card and the page on a post's own page (issue
     #170). The rule above and the line down the left of the words set it
     apart, the same line a note gets in Recent activity. The label says whose
     it is in words, in the quiet ink: green would read as a link. */
  .note { border-top: 1px solid var(--line); padding: var(--space-3) var(--space-4); font-size: calc(var(--text-sm) * var(--size-app)); }
  .head { display: flex; align-items: baseline; gap: var(--space-1); margin-bottom: var(--space-1); }
  .who { font-weight: 600; color: var(--text-2); }
  .who a { color: inherit; }
  .who a:hover { text-decoration: underline; }
  .when { font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); flex: 1; }
  .edit { font-size: calc(var(--text-sm) * var(--size-app)); font-weight: 600; color: var(--accent); }
  .body { color: var(--text); line-height: 1.5; overflow-wrap: anywhere; padding-left: var(--space-3); border-left: 2px solid var(--line); }
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
  .more { margin-top: var(--space-1); margin-left: calc(var(--space-3) + 2px); font-size: calc(var(--text-sm) * var(--size-app)); font-weight: 600; color: var(--text-2); }
  .more:hover { color: var(--accent); }
</style>
