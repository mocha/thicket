<script lang="ts">
  import { noOrphan } from '$lib/orphans';
  /**
   * One saved post, mine or someone else's. The whole body — words and
   * thumbnail — links to the post, opening it here or in a tab depending on
   * the reader's setting, the same as every other card. The one action in the
   * corner is whatever the page passes: remove for my own list, save for
   * someone else's.
   */
  import type { Bookmark, PublicBookmark } from '$lib/api';
  import { itemsApi } from '$lib/api';
  import { hostOf, relativeTime } from '$lib/time';
  import { openReader, readsInline } from '$lib/reader.svelte';
  import Card from './Card.svelte';
  import CardMeta from './CardMeta.svelte';
  import IconButton from './IconButton.svelte';

  let { b, onopen, action }: {
    b: Bookmark | PublicBookmark; onopen?: () => void;
    action?: { label: string; title?: string; on: boolean; run: () => void; kind: 'remove' | 'save' };
  } = $props();

  const site = $derived(b.siteTitle ?? hostOf(b.url));

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
        window.open(b.url, '_blank', 'noopener');
      }
      return;
    }
    onopen?.();
  }
</script>

<Card as="li" class="bm">
  <a class="body" href={b.url} target="_blank" rel="noopener" onclick={opened} onauxclick={opened}>
    <div class="text">
      <CardMeta feedId={b.feedId} hasIcon={b.hasIcon} name={site} when={b.publishedAt} />
      <h3 class="card-title">{noOrphan(b.title ?? b.url)}</h3>
      {#if b.summary}<p class="card-summary">{b.summary}</p>{/if}
      <div class="saved">Saved <time datetime={b.savedAt} title={new Date(b.savedAt).toLocaleString()}>{relativeTime(b.savedAt)}</time></div>
    </div>
    {#if b.imageUrl}<img class="thumb" src={b.imageUrl} alt="" loading="lazy" referrerpolicy="no-referrer" onerror={(e) => ((e.currentTarget as HTMLImageElement).hidden = true)} />{/if}
  </a>
  {#if action}
    {#if action.kind === 'remove'}
      <IconButton class="corner remove" icon="close" onclick={action.run} label={action.label} title={action.title ?? action.label} />
    {:else}
      <IconButton class="corner" icon="bookmark" pressed={action.on} onclick={action.run} label={action.label} title={action.title ?? action.label} />
    {/if}
  {/if}
</Card>

<style>
  .body { display: flex; gap: var(--space-3); align-items: center; }
  .text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: var(--space-1); padding-right: 28px; }
  @media (hover: hover) { .body:hover h3 { text-decoration: underline; text-decoration-color: var(--text-3); text-underline-offset: 3px; } }
  p { --summary-lines: 2; }
  .saved { font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-3); }
  .thumb { flex: none; width: 72px; height: 72px; object-fit: cover; border-radius: var(--radius-sm); background: var(--surface-2); }
  /* The one action sits in the card's top corner, over the body's padding. */
  :global(.bm .corner) { position: absolute; top: 6px; right: 6px; }
  /* Taking a bookmark away is the one destructive thing here, so it hovers red. */
  :global(.bm button.remove):hover { color: var(--danger); }
</style>
