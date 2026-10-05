<script lang="ts">
  import { openAddFeed } from '$lib/addfeed.svelte';
  import Button from '$lib/components/Button.svelte';

  /** The primary "Add new feed" call to action. One button, one look, wherever
      it appears. `via` names the place it was pressed, for analytics; pass
      `collectionIds` to drop the new feed straight into a collection.
      `bottomBarOnly` hides it wherever the left menu shows, because the menu
      has its own Add new feed at the top. */
  let { via, collectionIds, bottomBarOnly = false }: { via: string; collectionIds?: number[]; bottomBarOnly?: boolean } = $props();
</script>

<span class="add-feed-cta" class:bottom-bar-only={bottomBarOnly}>
  <Button variant="primary" size="sm" onclick={() => openAddFeed(collectionIds ? { via, collectionIds } : { via })}>
    <span class="plus" aria-hidden="true">+</span> Add new feed
  </Button>
</span>

<style>
  /* The wrapper only exists so this one call to action can carry its own
     responsive tweak; display:contents keeps it out of the layout, so the
     button stays the flex child it was. */
  .add-feed-cta {
    display: contents;
  }
  .add-feed-cta :global(.btn) {
    flex: none;
  }
  .plus {
    font-size: 1.3em;
    line-height: 1;
  }
  /* On a phone it tightens up so it doesn't outweigh the page title. */
  @media (max-width: 560px) {
    .add-feed-cta :global(.btn) {
      padding: var(--space-1) var(--space-3);
    }
    .plus {
      font-size: 1.15em;
    }
  }
  /* Where the left menu shows; the same condition as in Nav.svelte. The paged
     layout keeps the bottom bar at every width, so the button stays there. */
  @media (min-width: 900px) and (min-height: 501px), (min-width: 900px) and (pointer: fine) {
    :global(main:not(.paged)) .bottom-bar-only {
      display: none;
    }
  }
</style>
