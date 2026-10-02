<script lang="ts">
  import type { Snippet } from 'svelte';
  import { modality } from '$lib/focus.svelte';

  /**
   * The one many-line text box. Input's taller sibling: same box, same border,
   * same focus ring — quiet accent outline however you got here, the thick ring
   * only for someone tabbing through the page.
   *
   * `counter` shows how much room is left, warms up as you near the limit, and
   * turns red once you are over it. It sits inside the box, at the bottom
   * right under the text, so the box takes the same room on the page whether
   * it counts or not. Being over also tells screen readers the
   * box is wrong, so a form can refuse to send on the same condition. The
   * count is read out with the box, so someone using a screen reader hears how
   * much room is left without hunting for it.
   *
   * `limit` is the number the counter counts against when it differs from the
   * hard stop — a note that stops accepting text a little past its limit still
   * counts against the limit, so you can see how far over you are instead of
   * silently hitting a wall.
   *
   * `status` puts a short word of your own inside the box too, at the bottom
   * left on the counter's line: the "Saved" that follows a box which saves
   * itself.
   */
  interface Props {
    value: string;
    rows?: number;
    /** Whether the reader can drag it taller. Vertical by default. */
    resize?: 'vertical' | 'none';
    maxlength?: number;
    /** What the counter counts against, when that isn't the hard stop. */
    limit?: number;
    /** Show "so far / allowed" inside the box, bottom right. Needs a limit or a maxlength. */
    counter?: boolean;
    /** A short word inside the box, bottom left, e.g. "Saved". */
    status?: Snippet;
    invalid?: boolean;
    disabled?: boolean;
    /** Sit on the page background instead of the raised surface. */
    inset?: boolean;
    /** The box itself, for a caller that needs to focus or select it. */
    element?: HTMLTextAreaElement | null;
    oninput?: (e: Event & { currentTarget: HTMLTextAreaElement }) => void;
    onfocus?: (e: FocusEvent) => void;
    onblur?: (e: FocusEvent) => void;
    class?: string;
    /** Goes on the outer element, like `class` does. */
    style?: string;
    [key: string]: unknown;
  }

  let {
    value = $bindable(''),
    rows = 3,
    resize = 'vertical',
    maxlength,
    limit,
    counter = false,
    status,
    invalid = false,
    disabled = false,
    inset = false,
    element = $bindable(null),
    oninput,
    onfocus,
    onblur,
    class: klass = '',
    style,
    'aria-describedby': describedBy,
    ...rest
  }: Props = $props();

  /* The number shown and judged against: the limit when there is one, the hard
     stop otherwise. */
  const cap = $derived(limit ?? maxlength);
  const over = $derived(!!cap && value.length > cap);
  /* "Nearly there" starts with a tenth of the allowance left. */
  const near = $derived(!!cap && !over && value.length > cap * 0.9);
  const showCounter = $derived(counter && !!cap);
  const wrong = $derived(invalid || over);

  /* The count is part of what describes the box, alongside anything the caller
     already pointed at — a hint or an error from Field. */
  const uid = $props.id();
  const counterId = `${uid}-count`;
  const described = $derived(
    [describedBy, showCounter ? counterId : null].filter(Boolean).join(' ') || undefined
  );

  let byKeyboard = $state(false);

  function focused(e: FocusEvent) {
    byKeyboard = modality.keyboard;
    onfocus?.(e);
  }
  function blurred(e: FocusEvent) {
    byKeyboard = false;
    onblur?.(e);
  }
  /* The line the counter sits on is part of the box to the eye, so pressing it
     puts the cursor in the box rather than doing nothing. */
  function pressed(e: MouseEvent) {
    if (e.target === element || disabled) return;
    e.preventDefault();
    element?.focus();
  }
  function typed(e: Event & { currentTarget: HTMLTextAreaElement }) {
    value = e.currentTarget.value;
    oninput?.(e);
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="wrap {klass}" class:kb={byKeyboard} class:invalid={wrong} class:disabled class:inset class:grows={resize !== 'none'} {style} style:resize onmousedown={pressed}>
  <textarea
    bind:this={element}
    {value}
    {rows}
    {maxlength}
    {disabled}
    aria-invalid={wrong ? 'true' : undefined}
    aria-describedby={described}
    {...rest}
    oninput={typed}
    onfocus={focused}
    onblur={blurred}
  ></textarea>
  {#if showCounter || status}
    <div class="foot">
      <span class="status" aria-live="polite">{#if status}{@render status()}{/if}</span>
      {#if showCounter}<span class="counter" id={counterId} class:near class:over>{value.length}/{cap}</span>{/if}
    </div>
  {/if}
</div>

<style>
  /* The box is the wrapper, not the textarea, so the counter's line is inside
     the outline and one focus ring is drawn around the lot. */
  .wrap {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--field-line);
    border-radius: var(--radius-sm);
    background: var(--surface);
    transition: border-color 0.12s ease;
  }
  .inset { background: var(--bg); }
  /* Dragging taller is the box's job, not the textarea's, so the grip sits in
     the box's own corner, below the counter rather than floating above it.
     A box only shows the grip when its overflow is clipped. */
  .grows { overflow: hidden; min-height: 4.5em; }

  textarea {
    flex: 1 1 auto;
    min-width: 0;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--text);
    font-family: inherit;
    font-size: calc(var(--text-base) * var(--size-app));
    line-height: 1.45;
    resize: none;
  }
  textarea:focus { outline: none; }
  textarea::placeholder { color: var(--text-2); opacity: 1; }

  .wrap:focus-within { border-color: var(--accent); }
  .wrap.kb:focus-within { outline: 2px solid var(--accent); outline-offset: 1px; }

  .invalid { border-color: var(--danger); }

  .disabled { opacity: 0.55; }
  .disabled textarea { cursor: default; }

  .foot { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); cursor: text; }
  .status { font-size: calc(var(--text-xs) * var(--size-app)); font-weight: 600; color: var(--accent); }
  .counter {
    margin-left: auto;
    font-size: calc(var(--text-xs) * var(--size-app));
    color: var(--text-2);
    font-variant-numeric: tabular-nums;
  }
  .counter.near { color: var(--text); }
  .counter.over { color: var(--danger); font-weight: 700; }
  /* On a touchscreen a field's text is never under 16px: iOS Safari zooms the
     whole page in when a smaller field takes focus, and doesn't zoom back out. */
  @media (pointer: coarse) {
    textarea { font-size: max(16px, calc(var(--text-base) * var(--size-app))); }
  }
</style>
