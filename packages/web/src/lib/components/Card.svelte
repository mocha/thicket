<script lang="ts">
  import type { Snippet } from 'svelte';

  /**
   * The one card: the one box lifted off the page. It sets the surface color,
   * the rounded corner, the soft shadow, and on the two hard-edged color
   * themes the outline that stands in for the shadow. Nothing else in the app
   * draws that box for itself.
   *
   * Every card is one of three kinds, and cards of a kind look the same on
   * every screen:
   *
   * - `content` (the default): one post, bookmark, or starter pack. It holds
   *   the edge inset, clips what runs to its edge, and gives a little when
   *   pressed, since the whole card is something to tap.
   * - `list`: a card holding rows (Activity, a collection's feeds, Explore's
   *   results). No inset of its own; each row insets itself by `--card-pad`,
   *   and the card clips its corners so the first and last rows follow them.
   * - `section`: a group of settings, or a single message standing on its own
   *   (an empty section, who can see a profile tab). It holds the edge inset
   *   and nothing more: it doesn't clip, so a menu or a focus ring inside it
   *   can spill past its edge, and it doesn't move when pressed.
   *
   * The card sets its edge inset once, as `--card-pad`, so every card in the
   * app breathes the same distance from its own edge. A content card whose
   * content runs to the edge (a full-width picture, the note blocks under a
   * post) passes `pad={false}` and puts `var(--card-pad)` on its own rows.
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
   *
   * The space around a card (its margins) belongs to the screen. A screen
   * reaches the card's own element by giving it a class and styling that
   * class as `:global(...)` under one of its own elements.
   */
  interface Props {
    /** Which of the three kinds this card is. */
    kind?: 'content' | 'list' | 'section';
    /** The element this card really is. A card in a list is an `li`; a list card is the `ul` or `ol` itself. */
    as?: 'article' | 'li' | 'div' | 'section' | 'ul' | 'ol' | 'p';
    compact?: boolean;
    /** Whether the shell itself holds the edge inset. On for content and section cards, off for list cards. */
    pad?: boolean;
    children: Snippet;
    class?: string;
    [key: string]: unknown;
  }

  let { kind = 'content', as = 'article', compact = false, pad = kind !== 'list', children, class: klass = '', ...rest }: Props = $props();
</script>

<svelte:element this={as} class="card {kind} {klass}" class:compact class:pad {...rest}>
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
    list-style: none;
  }
  .pad { padding: var(--card-pad); }

  /* A content card is pressable as a whole, so it gives a little under a finger. */
  .content { overflow: hidden; transition: transform 120ms ease; }
  .content:active { transform: scale(0.99); }

  /* A list card clips its corners so the first and last rows follow them. As
     a ul or ol it drops the browser's own list spacing too, at no weight, so
     the margins a screen sets around the card always win. */
  .list { overflow: hidden; }
  :where(.list) { margin: 0; padding: 0; }

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
    /* A summary is often a bare web address; it wraps instead of running off the card. */
    overflow-wrap: anywhere;
  }
</style>
