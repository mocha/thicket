<script lang="ts">
  import { tick, type Snippet } from 'svelte';
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
   * Every password field can be shown. An eye at the end of the box switches
   * it between dots and plain text, so you can check what you typed on a phone.
   * It is a real toggle button ("Show password" / "Hide password", announced
   * as pressed while the password is showing), it keeps your cursor and what
   * you typed where they were, and it is on for every `type="password"` field
   * unless the caller passes `revealable={false}`.
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
    /** The show/hide eye on a password field, on by default. Ignored for other types. */
    revealable?: boolean;
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
    revealable = true,
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

  /* A password field carries the eye; pressing it shows the password as plain
     text until it is pressed again. */
  const canReveal = $derived(revealable && type === 'password' && !disabled);
  let revealed = $state(false);
  const shownType = $derived(canReveal && revealed ? 'text' : kind);

  /* Where the cursor was when the eye was pressed, if it was in the field.
     Swapping the field's type can drop the cursor, and on a phone the tap can
     move focus to the button, so both are put back afterwards. A keyboard
     press leaves focus on the eye, where the person pressing it put it. */
  let caret: { start: number | null; end: number | null } | null = null;
  function noteCaret() {
    caret = element && document.activeElement === element
      ? { start: element.selectionStart, end: element.selectionEnd }
      : null;
  }
  async function toggleReveal(e: MouseEvent) {
    /* A click from Enter or Space has no click count. */
    const keep = e.detail === 0 ? null : caret;
    caret = null;
    revealed = !revealed;
    if (!keep || !element) return;
    await tick();
    element.focus();
    try { element.setSelectionRange(keep.start, keep.end); } catch { /* nothing to restore */ }
  }

  const glyph = $derived(size === 'sm' ? 15 : 20);

  /* Password managers and browser autofill find a field by its name. A field
     that says what it's for gets the matching name unless the caller gave one. */
  const AUTOFILL_NAMES: Record<string, string> = {
    username: 'username',
    'current-password': 'password',
    'new-password': 'new-password',
    email: 'email',
    name: 'name',
    url: 'url'
  };
  const name = $derived((rest.name as string | undefined) ?? AUTOFILL_NAMES[rest.autocomplete as string]);

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

  /* The whole box is the field. A press on its padding or on something
     sitting beside the text (a magnifier, the "readthicket.com/@" before a
     handle) puts the cursor in the field, at the end of what's typed, rather
     than doing nothing. Buttons and links inside the box keep their own press. */
  function pressed(e: MouseEvent) {
    const t = e.target as HTMLElement;
    if (!element || disabled || t === element || t.closest('button, a')) return;
    e.preventDefault();
    element.focus();
    const end = element.value.length;
    try { element.setSelectionRange(end, end); } catch { /* email and number fields have no cursor position to set */ }
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
  class:hasreveal={canReveal}
  {style}
  onmousedown={pressed}
  role="presentation"
>
  {#if variant === 'search'}
    <span class="lead" aria-hidden="true"><Icon name="search" size={glyph} /></span>
  {/if}
  {#if leading}<span class="lead">{@render leading()}</span>{/if}
  <input
    bind:this={element}
    type={shownType}
    {value}
    {disabled}
    {readonly}
    aria-invalid={invalid ? 'true' : undefined}
    {...rest}
    {name}
    oninput={typed}
    onfocus={focused}
    onblur={blurred}
  />
  {#if showClear}
    <IconButton class="clear" icon="close" size="sm" label="Clear" onclick={clear} />
  {/if}
  {#if canReveal}
    <IconButton
      class="reveal"
      icon={revealed ? 'eye-off' : 'eye'}
      size="sm"
      iconSize={size === 'sm' ? 14 : 16}
      label={revealed ? 'Hide password' : 'Show password'}
      aria-pressed={revealed}
      onpointerdown={noteCaret}
      onmousedown={(e: MouseEvent) => e.preventDefault()}
      onclick={toggleReveal}
    />
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
    border: 1px solid var(--field-line);
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
  /* The eye is the last thing in the box, so the box tightens around it the
     same way it does for the clear X. */
  .hasreveal { padding-right: var(--space-2); }
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
     faint to read against the light palettes, and dimmer than typed text in
     the dark ones (see --placeholder in app.css). */
  input::placeholder { color: var(--placeholder); opacity: 1; }
  /* We draw our own clear button; hide the browser's so there aren't two. */
  input::-webkit-search-cancel-button { -webkit-appearance: none; appearance: none; }
  /* Same for Edge's own show-password eye: ours is the one that works everywhere. */
  input::-ms-reveal { display: none; }

  /* What sits beside the text reads as part of the hint, not as typed text,
     and pressing it types, so it shows the typing cursor. */
  .lead {
    flex: none;
    display: flex;
    align-items: center;
    color: var(--placeholder);
    cursor: text;
  }
  .wrap:not(.disabled) { cursor: text; }

  /* Focus, quietly: the outline turns the accent color however you got here. */
  .wrap:focus-within { border-color: var(--accent); }
  /* And loudly, only for someone tabbing through the page. */
  .wrap.kb:focus-within { outline: 2px solid var(--accent); outline-offset: 1px; }

  /* Starting something new: the accent outline and an accent-colored
     placeholder say "this makes a thing" before you have typed anything. */
  .create { border-color: var(--accent); }
  /* Full strength: thinned to 85% it fell under 4.5:1 in two of the warm themes. Soft sepia keeps the thinner one; it is low-contrast on purpose. */
  .create input::placeholder { color: var(--accent); opacity: 1; }
  :global(:root[data-palette='parchment']) .create input::placeholder { opacity: 0.85; }

  .invalid { border-color: var(--danger); }

  .disabled { opacity: 0.55; }
  .disabled input { cursor: default; }
  /* On a touchscreen a field's text is never under 16px: iOS Safari zooms the
     whole page in when a smaller field takes focus, and doesn't zoom back out. */
  @media (pointer: coarse) {
    /* And the small size is still a full 44px to tap. */
    .wrap.sm { min-height: 44px; }
    /* The clear X and the eye each get a 44px touch area around a 24px circle
       (see `.tap` in app.css), so with both showing they sit far enough apart
       that the two areas don't overlap. */
    .hasclear.hasreveal :global(.reveal) { margin-left: var(--space-3); }
    input, .sm input { font-size: max(16px, calc(var(--text-base) * var(--size-app))); }
  }
</style>
