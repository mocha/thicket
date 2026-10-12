<script lang="ts">
  /**
   * The one checkbox. Browsers draw their own and each draws it differently
   * (Chrome nearly square, Firefox rounded), so thicket draws it instead: a
   * 16px box with softly rounded corners, outlined like a text field, filled
   * with the accent and a check in the accent's own ink once ticked. 16px is
   * the height of a line of body text, so it sits evenly beside its label.
   *
   * Underneath it is still the real checkbox, so the keyboard, a screen
   * reader, and a wrapping <label> all work as they always do. Pass anything
   * an <input> takes (checked, disabled, onchange, aria-*); `bind:checked`
   * works too. A `class` goes on the outside, for the caller to place it.
   */
  import type { HTMLInputAttributes } from 'svelte/elements';

  interface Props extends Omit<HTMLInputAttributes, 'type' | 'checked' | 'class'> {
    checked?: boolean;
    class?: string;
  }

  let { checked = $bindable(false), class: klass = '', ...rest }: Props = $props();
</script>

<span class="checkbox {klass}">
  <input type="checkbox" bind:checked {...rest} />
  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 8.25 7 10.75 11.5 5.5" /></svg>
</span>

<style>
  .checkbox { position: relative; display: inline-grid; flex: none; width: 16px; height: 16px; vertical-align: middle; }
  input {
    appearance: none; margin: 0; width: 16px; height: 16px;
    /* 4px is optical: the field radius would turn a box this small into a circle. */
    border-radius: 4px;
    border: 1.5px solid var(--field-line);
    background: var(--surface);
    cursor: pointer;
  }
  input:checked { background: var(--accent); border-color: var(--accent); }
  input:disabled { cursor: not-allowed; opacity: 0.5; }
  input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  svg {
    position: absolute; inset: 0; width: 16px; height: 16px; pointer-events: none;
    fill: none; stroke: var(--accent-ink); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round;
    opacity: 0;
  }
  input:checked + svg { opacity: 1; }
</style>
