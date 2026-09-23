<script lang="ts">
  import type { Snippet } from 'svelte';

  /**
   * The one card. Every post that shows up in a list — in the river, in
   * Bookmarks, on a profile — sits on this: the surface color, the rounded
   * corner, the soft shadow, and on the two hard-edged color themes the
   * outline that stands in for the shadow.
   *
   * It also sets the card's edge inset once, as `--card-pad`, so every card in
   * the app breathes the same distance from its own edge. Cards whose content
   * runs to the edge (a full-width picture, the note blocks under a post) pass
   * `pad={false}` and put `var(--card-pad)` on their own rows instead.
   *
   * Two pieces of a card's text are shared too, because they should look the
   * same wherever a post turns up. Give the title the class `card-title` and
   * the summary `card-summary`: the title comes out in the headings face at
   * the one card title size, the summary in the reading face at body size, and
   * both stop after three lines. A card that wants fewer lines sets
   * `--title-lines` or `--summary-lines` on its own element.
   *
   * `compact` is the paged layout's density mode: a card that fills a fixed
   * frame, with a tighter edge and no press animation.
   */
  interface Props {
    /** The element this card really is. A card in a list is an `li`. */
    as?: 'article' | 'li' | 'div';
    compact?: boolean;
    /** Whether the shell itself holds the edge inset. Off for cards that bleed. */
    pad?: boolean;
    children: Snippet;
    class?: string;
    [key: string]: unknown;
  }

  let { as = 'article', compact = false, pad = true, children, class: klass = '', ...rest }: Props = $props();
</script>

<svelte:element this={as} class="card {klass}" class:compact class:pad {...rest}>
  {@render children()}
</svelte:element>

<style>
  .card {
    --card-pad: var(--space-4);
    position: relative;
    background: var(--surface);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    border: var(--card-border, 0);
    overflow: hidden;
    list-style: none;
    transition: transform 120ms ease;
  }
  .card:active { transform: scale(0.99); }
  .pad { padding: var(--card-pad); }

  /* Compact: a fixed height so a page of cards lines up, and a tighter edge. */
  .compact {
    --card-pad: var(--space-3);
    height: 100%;
    display: flex;
    flex-direction: column;
  }
  .compact:active { transform: none; }

  /* The one card title and the one card summary. Both are written as global
     rules because the elements they dress belong to the card composing this
     one, not to this file. */
  .card :global(.card-title) {
    margin: 0;
    font-family: var(--font-headings);
    text-wrap: pretty;
    font-weight: 600;
    font-size: calc(var(--text-lg) * var(--size-headings));
    line-height: 1.25;
    letter-spacing: -0.01em;
    overflow-wrap: anywhere;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: var(--title-lines, 3);
    line-clamp: var(--title-lines, 3);
    overflow: hidden;
    /* The clamp clips at the box edge, which sat right on the last line's baseline
       and sliced the tails of p, g and y. A little room below keeps them whole. */
    padding-bottom: 0.15em;
    margin-bottom: -0.15em;
  }
  .card :global(.card-summary) {
    /* Air between the title and the summary; a card can tighten it with --summary-gap. */
    margin: var(--summary-gap, var(--space-2)) 0 0;
    color: var(--text-2);
    font-family: var(--font-reading);
    font-size: calc(var(--text-base) * var(--size-reading));
    line-height: 1.45;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: var(--summary-lines, 3);
    line-clamp: var(--summary-lines, 3);
    overflow: hidden;
  }
</style>
