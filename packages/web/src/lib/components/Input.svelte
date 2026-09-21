<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';
  import IconButton from './IconButton.svelte';
  import { modality } from '$lib/focus.svelte';

  /**
   * The one text field. A box you type one line into: an address, a handle, a
   * password, a search.
   *
   * Three sizes. Small is the slim one that sits inside a list or a sidebar;
   * medium is the everyday field on a form; large is the roomy one a page is
   * built around. Medium and large are set at body size on purpose — a field
   * below that makes an iPhone zoom in the moment you tap it.
   *
   * Three looks, all the same shape: the plain one; `search`, which adds a
   * magnifier in front; and `create`, the accent-outlined box for starting
   * something new. Every field in the app is the same rounded rectangle —
   * buttons are the pills, fields are not.
   *
   * Every field clears. A small X turns up at the end as soon as there is
   * something to clear, empties the field, leaves your cursor in it, and tells
   * the caller through both `oninput` and `onclear`. With a Create button
   * inside the box, the X sits between the text and the button.
   *
   * The focus ring is the point of this component. Focus of any kind turns the
   * outline the accent color, quietly. The thick ring on top of it appears only
   * when focus arrived by keyboard, so clicking into a field no longer looks
   * like tabbing into one. See lib/focus.svelte.ts.
   *
   * `leading` and `trailing` put your own thing inside the box, before or after
   * the text — the "@" in front of a handle, a Create button after a name. Set
   * `--field-gap` to tighten the space beside a text prefix.
   */
  interface Props {
    value: string;
    type?: 'text' | 'email' | 'password' | 'url' | 'search' | 'tel';
    size?: 'sm' | 'md' | 'lg';
    variant?: 'default' | 'search' | 'create';
    /** Draw the box in the danger color and tell screen readers it's wrong. */
    invalid?: boolean;
    disabled?: boolean;
    readonly?: boolean;
    /** The clear X, on by default. Off only for a field that must not be emptied. */
    clearable?: boolean;
    onclear?: () => void;
    /** Sit on the page background instead of the raised surface. */
    inset?: boolean;
    leading?: Snippet;
    trailing?: Snippet;
    /** The field itself, for a caller that needs to focus or select it. */
    element?: HTMLInputElement | null;
    oninput?: (e: Event & { currentTarget: HTMLInputElement }) => void;
    onfocus?: (e: FocusEvent) => void;
    onblur?: (e: FocusEvent) => void;
    class?: string;
    /** Goes on the box, like `class` does — so `--field-gap` lands where it works. */
    style?: string;
    [key: string]: unknown;
  }

  let {
    value = $bindable(''),
    type,
    size = 'md',
    variant = 'default',
    invalid = false,
    disabled = false,
    readonly = false,
    clearable = true,
    onclear,
    inset = false,
    leading,
    trailing,
    element = $bindable(null),
    oninput,
    onfocus,
    onblur,
    class: klass = '',
    style,
    ...rest
  }: Props = $props();

  /* Nothing to clear when it's empty, and no clearing a field you can't edit. */
  const showClear = $derived(clearable && !!value && !disabled && !readonly);

  /* A search box asks for the search keyboard unless told otherwise. We draw
     our own clear button, so the browser's is hidden in the styles below. */
  const kind = $derived(type ?? (variant === 'search' ? 'search' : 'text'));

  const glyph = $derived(size === 'sm' ? 15 : 20);

  /* Whether this focus arrived by keyboard. Read once as focus lands and kept,
     so typing in a field you clicked doesn't light the ring up mid-sentence. */
  let byKeyboard = $state(false);

  function focused(e: FocusEvent) {
    byKeyboard = modality.keyboard;
    onfocus?.(e);
  }
  function blurred(e: FocusEvent) {
    byKeyboard = false;
    onblur?.(e);
  }
  function typed(e: Event & { currentTarget: HTMLInputElement }) {
    value = e.currentTarget.value;
    oninput?.(e);
  }
  /* Emptying the field is a real edit, so it goes through the same path typing
     does — the caller hears about it on `oninput` as well as `onclear`, and a
     field whose value the caller owns one-way still updates. */
  function clear() {
    if (element) {
      element.value = '';
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.focus();
    } else {
      value = '';
    }
    onclear?.();
  }
</script>

<div
  class="wrap {variant} {size} {klass}"
  class:kb={byKeyboard}
  class:invalid
  class:disabled
  class:inset
  class:hasclear={showClear}
  class:hastrail={!!trailing}
  {style}
>
  {#if variant === 'search'}
    <span class="lead" aria-hidden="true"><Icon name="search" size={glyph} /></span>
  {/if}
  {#if leading}<span class="lead">{@render leading()}</span>{/if}
  <input
    bind:this={element}
    type={kind}
    {value}
    {disabled}
    {readonly}
    aria-invalid={invalid ? 'true' : undefined}
    {...rest}
    oninput={typed}
    onfocus={focused}
    onblur={blurred}
  />
  {#if showClear}
    <IconButton class="clear" icon="close" size="sm" label="Clear" onclick={clear} />
  {/if}
  {#if trailing}{@render trailing()}{/if}
</div>

<style>
  /* The box is the wrapper, not the field: that way anything sitting inside it
     — a magnifier, an "@", a Create button — is inside the outline, and one
     focus ring is drawn around the lot. */
  .wrap {
    display: flex;
    align-items: center;
    gap: var(--field-gap, var(--space-2));
    min-width: 0;
    width: 100%;
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--line);
    /* Single-line fields are pills, like buttons; Textarea keeps --radius-sm because a pill cannot wrap several lines. */
    border-radius: var(--radius-pill);
    background: var(--surface);
    color: var(--text-2);
    transition: border-color 0.12s ease;
  }
  .inset { background: var(--bg); }

  .sm { padding: var(--space-2) var(--space-3); }

  /* One shape for every field, whatever its size or look: the rounded
     rectangle set on .wrap above. Pills are for buttons. */

  /* Room on the right for the clear button without pushing the text under it. */
  .hasclear { padding-right: var(--space-2); }
  /* A button living inside the box brings its own height and its own edge, so
     the box tightens around it rather than framing it in white space. */
  .hastrail { padding: var(--space-1); padding-left: var(--space-4); }
  .sm.hastrail { padding: var(--space-1); padding-left: var(--space-3); }

  input {
    flex: 1;
    min-width: 0;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--text);
    font-family: inherit;
    font-size: calc(var(--text-base) * var(--size-app));
    /* A long query trails off rather than scrolling out of sight. */
    text-overflow: ellipsis;
  }
  .sm input { font-size: calc(var(--text-sm) * var(--size-app)); }
  /* The wrapper draws the ring, so the field inside draws nothing. */
  input:focus { outline: none; }
  /* The placeholder is a shade darker than the browser's own, which is too
     faint to read against the light palettes. */
  input::placeholder { color: var(--text-2); opacity: 1; }
  /* We draw our own clear button; hide the browser's so there aren't two. */
  input::-webkit-search-cancel-button { -webkit-appearance: none; appearance: none; }

  .lead {
    flex: none;
    display: flex;
    align-items: center;
    color: var(--text-2);
  }

  /* Focus, quietly: the outline turns the accent color however you got here. */
  .wrap:focus-within { border-color: var(--accent); }
  /* And loudly, only for someone tabbing through the page. */
  .wrap.kb:focus-within { outline: 2px solid var(--accent); outline-offset: 1px; }

  /* Starting something new: the accent outline and an accent-colored
     placeholder say "this makes a thing" before you have typed anything. */
  .create { border-color: var(--accent); }
  .create input::placeholder { color: var(--accent); opacity: 0.85; }

  .invalid { border-color: var(--danger); }

  .disabled { opacity: 0.55; }
  .disabled input { cursor: default; }
</style>
