<script lang="ts">
  import { openAddFeed } from '$lib/addfeed.svelte';

  /** The primary "Add new feed" call to action. One button, one look, wherever
      it appears. `via` names the place it was pressed, for analytics; pass
      `collectionIds` to drop the new feed straight into a collection. */
  let { via, collectionIds }: { via: string; collectionIds?: number[] } = $props();
</script>

<button class="btn" type="button" onclick={() => openAddFeed(collectionIds ? { via, collectionIds } : { via })}>
  <span aria-hidden="true">+</span> Add new feed
</button>

<style>
  .btn { flex: none; display: inline-flex; align-items: center; gap: 6px; padding: 9px 14px; border-radius: 999px; border: 1px solid transparent; background: var(--accent); color: var(--accent-ink); font-size: calc(14px * var(--size-app)); font-weight: 600; white-space: nowrap; }
  .btn:hover { background: color-mix(in srgb, var(--accent) 88%, black); }
  .btn span { font-size: calc(18px * var(--size-app)); line-height: 1; }
  /* On a phone it steps down to a compact secondary action so it doesn't
     outweigh the page title. */
  @media (max-width: 560px) {
    .btn { padding: 6px 12px; gap: 5px; font-size: calc(11.5px * var(--size-app)); }
    .btn span { font-size: calc(13px * var(--size-app)); }
  }
</style>
