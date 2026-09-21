<script lang="ts">
  import type { Snippet } from 'svelte';

  /**
   * The one small pill. A short status word or a count that rides alongside
   * something else — a heading, a row, a name. It is never something you press:
   * anything clickable is a Button, an IconButton, or a ChoiceGroup option.
   *
   * Three looks, and only three:
   *   neutral pill  the quiet gray one — a label ("Private") or a count ("12")
   *   accent pill   the filled one, for "what's new" counts that should catch
   *                 the eye
   *   dot           an 8px accent circle for "something new" where a number
   *                 would say nothing. The dot is always the accent color;
   *                 there is no quiet dot.
   *
   * One size, built on the shared type, spacing and color tokens so every pill
   * in the app matches. A plain number sitting in a sentence stays plain text —
   * don't reach for this just because there is a number.
   *
   * Numbers line up because the pill uses tabular figures, so a count that
   * ticks from 9 to 10 doesn't shuffle the row.
   *
   * Where the pill sits is the caller's business: pass a class and style the
   * position from the parent (with :global, since the class crosses into this
   * component).
   */
  interface Props {
    tone?: 'neutral' | 'accent';
    variant?: 'pill' | 'dot';
    /** Hover text. On a dot it is also what a screen reader announces. */
    title?: string;
    /** The words or number. Left off for a dot. */
    children?: Snippet;
    class?: string;
    [key: string]: unknown;
  }

  let {
    tone = 'neutral',
    variant = 'pill',
    title,
    children,
    class: klass = '',
    ...rest
  }: Props = $props();

  /* A bare dot says nothing out loud, so it is hidden from screen readers
     unless the caller gave it words of its own. */
  const silent = $derived(variant === 'dot' && !title && !rest['aria-label']);
</script>

{#if variant === 'dot'}
  <span class="badge dot {klass}" {title} aria-hidden={silent ? 'true' : undefined} {...rest}></span>
{:else}
  <span class="badge pill {tone} {klass}" {title} {...rest}>{@render children?.()}</span>
{/if}

<style>
  .badge {
    flex: none;
  }

  .pill {
    display: inline-block;
    padding: 2px var(--space-2);
    border-radius: var(--radius-pill);
    font-size: calc(var(--text-sm) * var(--size-app));
    font-weight: 600;
    line-height: 1.5;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  /* On the two hard-edged color themes every surface is the same flat color,
     so the quiet pill would melt into the page. There it gets the same outline
     the cards get. */
  .pill.neutral {
    background: var(--surface-2);
    color: var(--text-2);
    border: var(--card-border, 0);
  }

  .pill.accent {
    background: var(--accent);
    color: var(--accent-ink);
  }

  /* The ring lifts the dot off whatever it is pinned to — an icon, an avatar.
     A dot sitting inline in a row doesn't need it and turns it off locally. */
  .dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 0 2px var(--surface);
  }
</style>
