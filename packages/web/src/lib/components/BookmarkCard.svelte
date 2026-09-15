<script lang="ts">
  /**
   * One saved post, mine or someone else's. The body links out (click out is
   * the reading model); the one action in the corner is whatever the page
   * passes: remove for my own list, save for someone else's.
   */
  import type { Bookmark, PublicBookmark } from '$lib/api';
  import { hostOf, relativeTime } from '$lib/time';
  import SourceIcon from './SourceIcon.svelte';

  let { b, onopen, action }: {
    b: Bookmark | PublicBookmark; onopen?: () => void;
    action?: { label: string; title?: string; on: boolean; run: () => void; kind: 'remove' | 'save' };
  } = $props();
</script>

<li class="bm">
  <a class="body" href={b.url} target="_blank" rel="noopener" onclick={onopen}>
    <div class="meta">
      <SourceIcon feedId={b.feedId} hasIcon={b.hasIcon} name={b.siteTitle ?? hostOf(b.url)} size={18} />
      <span class="site">{b.siteTitle ?? hostOf(b.url)}</span>
      {#if b.publishedAt}<span class="dot">·</span><time>{relativeTime(b.publishedAt)}</time>{/if}
    </div>
    <h3>{b.title ?? b.url}</h3>
    {#if b.summary}<p>{b.summary}</p>{/if}
    <div class="saved">Saved {relativeTime(b.savedAt)}</div>
  </a>
  {#if b.imageUrl}<img class="thumb" src={b.imageUrl} alt="" loading="lazy" referrerpolicy="no-referrer" onerror={(e) => ((e.currentTarget as HTMLImageElement).hidden = true)} />{/if}
  {#if action}
    {#if action.kind === 'remove'}
      <button class="remove" onclick={action.run} aria-label={action.label} title={action.title ?? action.label}>×</button>
    {:else}
      <button class="save" class:on={action.on} onclick={action.run} aria-pressed={action.on} aria-label={action.label} title={action.title ?? action.label}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill={action.on ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 4h12v17l-6-4-6 4z" /></svg>
      </button>
    {/if}
  {/if}
</li>

<style>
  .bm { position: relative; display: flex; gap: 12px; background: var(--surface); border-radius: var(--radius); box-shadow: var(--shadow); padding: 12px 14px; list-style: none; }
  .body { flex: 1; min-width: 0; padding-right: 28px; }
  .meta { display: flex; align-items: center; gap: 6px; font-size: calc(12px * var(--size-app)); color: var(--text-3); margin-bottom: 4px; min-width: 0; }
  .site { font-weight: 600; color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  h3 { margin: 0; font-family: var(--font-headings); font-size: calc(17px * var(--size-headings)); line-height: 1.3; font-weight: 600; overflow-wrap: anywhere; }
  .body p { margin: 4px 0 0; font-size: calc(14px * var(--size-app)); color: var(--text-2); display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .saved { margin-top: 6px; font-size: calc(12px * var(--size-app)); color: var(--text-3); }
  .thumb { flex: none; width: 72px; height: 72px; object-fit: cover; border-radius: var(--radius-sm); background: var(--surface-2); align-self: center; }
  .remove, .save { position: absolute; top: 6px; right: 6px; width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; color: var(--text-3); }
  .remove { font-size: calc(18px * var(--size-app)); }
  .remove:hover { color: var(--danger); background: var(--surface-2); }
  .save:hover { background: var(--surface-2); color: var(--accent); }
  .save.on { color: var(--accent); }
</style>
