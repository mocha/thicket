<script lang="ts">
  /**
   * The top of a page: its name, what it is, and a line that closes the
   * header. The page's own actions sit at the right end of that line, so the
   * name always has the full width and stays with its description.
   *
   * `above` is anything small that sits over the name (a way back). `title`
   * replaces the plain name when it needs more than words (a picture, a
   * Breadcrumb). `children` is anything else that belongs to the header,
   * after the description (a feed's numbers).
   */
  import type { Snippet } from 'svelte';

  interface Props {
    name?: string;
    above?: Snippet;
    title?: Snippet;
    description?: Snippet;
    actions?: Snippet;
    children?: Snippet;
    /** False for a page whose content follows straight on, like a post's text; its actions, if any, still sit at the right. */
    line?: boolean;
  }

  let { name, above, title, description, actions, children, line = true }: Props = $props();
</script>

<header class="pagehead">
  {#if above}<div class="above">{@render above()}</div>{/if}
  {#if title}{@render title()}{:else}<h1>{name}</h1>{/if}
  {#if description}<div class="desc">{@render description()}</div>{/if}
  {@render children?.()}
  {#if line || actions}<div class="rule" class:noline={!line}>{#if actions}<div class="actions">{@render actions()}</div>{/if}</div>{/if}
</header>

<style>
  .pagehead { margin-bottom: var(--space-5); }
  /* The way back sits apart from the page it leads out of, over a line of its own. */
  .above { margin-bottom: var(--space-4); padding-bottom: var(--space-3); border-bottom: 1px solid var(--line); font-size: calc(var(--text-sm) * var(--size-app)); }
  h1 { font-family: var(--font-headings); font-size: calc(var(--text-2xl) * var(--size-headings)); line-height: 1.2; margin: 0; min-width: 0; text-wrap: balance; overflow-wrap: anywhere; }
  .desc { margin-top: var(--space-1); color: var(--text-2); font-size: calc(var(--text-sm) * var(--size-app)); max-width: 62ch; text-wrap: pretty; }
  .desc :global(p) { margin: 0; }
  .desc :global(a) { color: var(--accent); font-weight: 600; }
  /* The line runs from the left edge to the actions, or the whole width without them. */
  .rule { display: flex; align-items: center; gap: var(--space-3); margin-top: var(--space-4); min-height: 1px; }
  .rule::before { content: ''; flex: 1; border-top: 1px solid var(--line); }
  /* The line runs through the middle of the buttons, so with buttons it starts closer: the buttons sit just under the description, rather than half a button pushing the line further down. */
  .rule:has(> .actions:not(:empty)) { margin-top: var(--space-1); }
  /* On phones the buttons sit a little lower, so they don't crowd the description, and what follows comes a little closer, since the buttons already hang below the line. */
  @media (max-width: 899px) {
    .rule:has(> .actions:not(:empty)) { margin-top: var(--space-3); }
    .pagehead:has(.actions:not(:empty)) { margin-bottom: var(--space-3); }
  }
  /* Actions that render nothing (signed out, say) leave the line its full width. */
  .actions:empty { display: none; }
  .noline::before { border-top: 0; }
  .actions { display: flex; flex: none; align-items: center; gap: var(--space-2); }
  /* Where the left menu holds Add new feed, a page whose only action is that button has no actions to show, so the line runs the full width. The same condition as in Nav.svelte. */
  @media (min-width: 900px) and (min-height: 501px), (min-width: 900px) and (pointer: fine) {
    :global(main:not(.paged)) .actions:has(> :global(.bottom-bar-only:only-child)) { display: none; }
    :global(main:not(.paged)) .rule:has(> .actions > :global(.bottom-bar-only:only-child)) { margin-top: var(--space-4); }
  }
</style>
