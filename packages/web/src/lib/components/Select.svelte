<script lang="ts">
  import type { Snippet } from 'svelte';
  import Field from './Field.svelte';
  import Icon from './Icon.svelte';
  import { modality } from '$lib/focus.svelte';

  /**
   * The one dropdown. A closed box showing the current choice, with a small
   * caret at its right; pressing it opens the operating system's own menu of
   * choices. Use it for picking one thing out of a short, fixed list — a
   * source, a sort order, a span of time.
   *
   * It is a rounded rectangle, not a pill. Single-line text fields and buttons
   * are the pills here; a dropdown is neither. It is a picker — a thing you
   * press to choose from a list — and rounding it all the way made it read as
   * a field you could type into. So it takes --radius-sm, the softer corner.
   *
   * Two sizes. Small is the one that sits in a filter bar beside other small
   * controls; medium is the everyday one on a form. Small is set below body
   * size, so on an iPhone tapping it may zoom the page in slightly — the same
   * trade the small text field makes.
   *
   * Choices come either as `options`, a plain list of value-and-label pairs
   * (preferred), or as raw <option> tags written inside the tag, for the rare
   * list that can't express.
   *
   * A name is always written, even when it isn't shown. `hideLabel` keeps it
   * for screen readers only — right for a dropdown whose first choice already
   * says what it is, like "By source…".
   *
   * The focus behavior matches the text field: focus of any kind turns the
   * outline the accent color, quietly, and the thick ring lands on top of it
   * only when focus arrived by keyboard. See lib/focus.svelte.ts.
   *
   * The open menu itself is drawn by the operating system, not by us, so it
   * looks like every other dropdown on the reader's machine. That is on
   * purpose: it is the part people already know how to use.
   */
  interface SelectOption {
    value: string;
    label: string;
    disabled?: boolean;
  }

  interface Props {
    value: string;
    /** The choices. Preferred over writing <option> tags by hand. */
    options?: SelectOption[];
    /** Raw <option> tags, for the rare list `options` can't express. */
    children?: Snippet;
    /** What this dropdown is called. Required, even when hidden. */
    label: string;
    /** Keep the name for screen readers but don't draw it. */
    hideLabel?: boolean;
    /** The steady note underneath. */
    hint?: string;
    /** What went wrong. Replaces the hint and marks the control invalid. */
    error?: string | null;
    size?: 'sm' | 'md';
    disabled?: boolean;
    /** Draw the box in the danger color and tell screen readers it's wrong. */
    invalid?: boolean;
    /** The dropdown itself, for a caller that needs to focus it. */
    element?: HTMLSelectElement | null;
    onchange?: (e: Event & { currentTarget: HTMLSelectElement }) => void;
    onfocus?: (e: FocusEvent) => void;
    onblur?: (e: FocusEvent) => void;
    /** Goes on the whole labelled control, so a caller can place it. */
    class?: string;
    [key: string]: unknown;
  }

  let {
    value = $bindable(''),
    options,
    children: slot,
    label,
    hideLabel = false,
    hint,
    error = null,
    size = 'md',
    disabled = false,
    invalid = false,
    element = $bindable(null),
    onchange,
    onfocus,
    onblur,
    class: klass = '',
    ...rest
  }: Props = $props();

  const glyph = $derived(size === 'sm' ? 15 : 20);

  /* Whether this focus arrived by keyboard. Read once as focus lands and kept,
     so the ring doesn't turn up later on a dropdown that was clicked. */
  let byKeyboard = $state(false);

  function focused(e: FocusEvent) {
    byKeyboard = modality.keyboard;
    onfocus?.(e);
  }
  function blurred(e: FocusEvent) {
    byKeyboard = false;
    onblur?.(e);
  }
  function picked(e: Event & { currentTarget: HTMLSelectElement }) {
    value = e.currentTarget.value;
    onchange?.(e);
  }
</script>

<Field {label} {hideLabel} {hint} {error} class={klass}>
  {#snippet children({ id, describedBy, invalid: fieldInvalid })}
    <div class="wrap {size}" class:kb={byKeyboard} class:invalid={invalid || fieldInvalid} class:disabled>
      <select
        {id}
        bind:this={element}
        {value}
        {disabled}
        aria-describedby={describedBy}
        aria-invalid={invalid || fieldInvalid ? 'true' : undefined}
        {...rest}
        onchange={picked}
        onfocus={focused}
        onblur={blurred}
      >
        {#if options}
          {#each options as o (o.value)}
            <option value={o.value} disabled={o.disabled}>{o.label}</option>
          {/each}
        {:else if slot}
          {@render slot()}
        {/if}
      </select>
      <span class="caret" aria-hidden="true"><Icon name="caret" dir="down" size={glyph} /></span>
    </div>
  {/snippet}
</Field>

<style>
  /* The wrapper is here only to hang the caret off the right-hand edge. The
     box itself is the dropdown, so there are no two shapes to keep in step. */
  .wrap {
    position: relative;
    display: flex;
    min-width: 0;
  }

  select {
    /* Fills the room it's given, and sizes to its longest choice when the
       layout leaves that up to it — the way a dropdown normally behaves. */
    flex: 1;
    min-width: 0;
    /* No native arrow: we draw our own so it matches every other caret here. */
    appearance: none;
    -webkit-appearance: none;
    border: 1px solid var(--line);
    /* A picker, not a text field — see the note at the top of this file. */
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font-family: inherit;
    font-size: calc(var(--text-base) * var(--size-app));
    line-height: 1.4;
    padding: var(--space-3) var(--space-4);
    /* Room at the end so a long choice never runs under the caret. */
    padding-right: calc(var(--space-4) + 20px + var(--space-2));
    /* A long choice trails off rather than stretching the box off the page. */
    text-overflow: ellipsis;
    transition: border-color 0.12s ease;
  }
  .sm select {
    font-size: calc(var(--text-sm) * var(--size-app));
    padding: var(--space-2) var(--space-3);
    padding-right: calc(var(--space-3) + 15px + var(--space-2));
  }

  /* Focus, quietly: the outline turns the accent color however you got here. */
  select:focus { outline: none; border-color: var(--accent); }
  /* And loudly, only for someone tabbing through the page. */
  .kb select:focus { outline: 2px solid var(--accent); outline-offset: 1px; }

  .invalid select { border-color: var(--danger); }

  .disabled { opacity: 0.55; }
  .disabled select { cursor: default; }

  /* The caret sits on top of the box and lets every press through to it. */
  .caret {
    position: absolute;
    top: 0;
    bottom: 0;
    right: var(--space-4);
    display: flex;
    align-items: center;
    color: var(--text-2);
    pointer-events: none;
  }
  .sm .caret { right: var(--space-3); }
</style>
