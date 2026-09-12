<script lang="ts">
  /**
   * One note under a post: mine ("My note:") or someone's ("@bob's note:").
   * Shows three lines, then "Show more" slides the rest out. Mine has Edit.
   * Rendering is our own safe Markdown subset (lib/markdown.ts).
   */
  import type { Note, PublicNote } from '$lib/api';
  import { profileHref } from '$lib/api';
  import { renderMarkdown } from '$lib/markdown';
  import { relativeTime } from '$lib/time';

  let { note, mine = false, onedit }: { note: Note | PublicNote; mine?: boolean; onedit?: () => void } = $props();
  let expanded = $state(false);
  let body = $state<HTMLElement | null>(null);
  let overflows = $state(false);
  const html = $derived(renderMarkdown(note.body));
  const edited = $derived(new Date(note.updatedAt).getTime() - new Date(note.createdAt).getTime() > 60_000);
  const author = $derived('author' in note ? note.author : null);

  // Only offer "Show more" when the clamped box is actually hiding something.
  $effect(() => {
    void html;
    if (!body || expanded) return;
    overflows = body.scrollHeight > body.clientHeight + 2;
  });
</script>

<div class="note" class:mine>
  <div class="head">
    <span class="who">
      {#if mine}My note:{:else if author}<a href={profileHref(author.handle)}>{author.displayName ?? `@${author.handle}`}</a>’s note:{/if}
    </span>
    <span class="when" title={new Date(note.createdAt).toLocaleString()}>{relativeTime(note.createdAt)}{#if edited} · edited {relativeTime(note.updatedAt)}{/if}</span>
    {#if mine && onedit}<button class="edit" onclick={onedit}>Edit</button>{/if}
  </div>
  <div class="body" class:clamped={!expanded} bind:this={body}>{@html html}</div>
  {#if overflows || expanded}
    <button class="more" onclick={() => (expanded = !expanded)} aria-expanded={expanded}>{expanded ? 'Show less' : 'Show more'}</button>
  {/if}
</div>

<style>
  .note { border-top: 1px solid var(--line); padding: 10px 16px 12px; background: color-mix(in srgb, var(--surface-2) 55%, var(--surface)); font-size: 14px; }
  .note.mine { background: color-mix(in srgb, var(--accent) 9%, var(--surface)); }
  .head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 4px; }
  .who { font-weight: 700; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-2); }
  .mine .who { color: var(--accent); }
  .who a { color: inherit; }
  .who a:hover { text-decoration: underline; }
  .when { font-size: 12px; color: var(--text-3); flex: 1; }
  .edit { font-size: 12px; font-weight: 600; color: var(--accent); }
  .body { color: var(--text); line-height: 1.5; overflow-wrap: anywhere; }
  .body.clamped { display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
  .body :global(p) { margin: 0 0 6px; }
  .body :global(p:last-child), .body :global(ul:last-child), .body :global(ol:last-child), .body :global(blockquote:last-child), .body :global(pre:last-child) { margin-bottom: 0; }
  .body :global(ul), .body :global(ol) { margin: 0 0 6px; padding-left: 22px; }
  .body :global(blockquote) { margin: 0 0 6px; padding-left: 10px; border-left: 3px solid var(--line); color: var(--text-2); }
  .body :global(code) { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.92em; background: var(--surface-2); padding: 1px 5px; border-radius: 5px; }
  .body :global(pre) { margin: 0 0 6px; padding: 8px 10px; background: var(--surface-2); border-radius: 8px; overflow-x: auto; }
  .body :global(pre code) { background: none; padding: 0; }
  .body :global(a) { color: var(--accent); font-weight: 600; text-decoration: underline; text-decoration-color: color-mix(in srgb, var(--accent) 40%, transparent); }
  .more { margin-top: 4px; font-size: 12px; font-weight: 600; color: var(--text-3); }
  .more:hover { color: var(--accent); }
</style>
