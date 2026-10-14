<script lang="ts">
  import type { Snippet } from 'svelte';

  /**
   * The small line at the bottom of a card: a few words on the left (who
   * wrote the post, when it was saved) and what you can do on the right. The
   * same row, in the same place, on the article card and the Bookmark card.
   *
   * It sits outside the card's link, since a button can't go inside a link.
   * The buttons' round hover backgrounds run past their icons, so the row
   * stops short on the right and the icons line up with the text's edge.
   *
   * `compact`: the paged layout's fixed-height card, a little less room below.
   * `section`: the footer of a section card, which pads itself: a line above
   * it instead of the post card's inset, and the action at the right end, a Button
   * of the regular size as a card's only action (a feed's Manage
   * page: "Last checked … · Check again now").
   */
  interface Props {
    /** The words on the left. */
    children?: Snippet;
    /** The buttons on the right. */
    actions?: Snippet;
    compact?: boolean;
    section?: boolean;
    class?: string;
  }

  let { children, actions, compact = false, section = false, class: klass = '' }: Props = $props();
</script>

<footer class={klass} class:compact class:section>
  {@render children?.()}
  <span class="spacer"></span>
  {#if actions}<span class="actions">{@render actions()}</span>{/if}
</footer>

<style>
  footer {
    display: flex; align-items: center; gap: var(--space-2); min-height: 32px;
    padding: 0 var(--space-2) var(--space-2) var(--card-pad);
    font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2);
  }
  footer.compact { padding-bottom: var(--space-1); }
  footer.section { flex-wrap: wrap; padding: var(--space-3) 0 0; border-top: 1px solid var(--line); }
  .spacer { flex: 1; }
  .actions { display: flex; align-items: center; flex: none; }
</style>
