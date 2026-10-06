<script lang="ts">
  import Icon from './Icon.svelte';
  import { modality } from '$lib/focus.svelte';

  /**
   * The one icon-only button. A round tap target with a single glyph and no
   * visible words, so `label` is required: it is the name the button is
   * announced by, and the tooltip if the caller passes `title` as well.
   *
   * Renders a <button>, or an <a> when given href, the same way Button does.
   *
   * The size scale is three circles: sm 24px, md 32px, lg 40px.
   * The two looks are plain (no border; hover paints the surface behind it)
   * and bordered (the outlined circle that sits beside a page title).
   *
   * Give `pressed` only to a toggle. It announces the on/off state and, when
   * on, fills the glyph and turns it the accent color.
   *
   * Give `stretch` when the circle sits in the middle of a bigger tap area,
   * like the page-turn strips down each side of the screen. The button's click
   * area grows to fill its nearest positioned container while the circle stays
   * the same size, so there is still one real button to focus and announce.
   *
   * The focus ring shows only when focus arrived by keyboard. A Sheet or
   * dialog hands focus to its first control as it opens, often its close
   * button, and some browsers (Safari on iPad) would ring it even though the
   * reader tapped to open it.
   */
  interface Props {
    icon: 'gear' | 'pencil' | 'close' | 'caret' | 'back' | 'dots' | 'bookmark' | 'note' | 'eye' | 'eye-off';
    label: string;
    /** Which way a caret points. Ignored by the glyphs that have no direction. */
    dir?: 'right' | 'down' | 'left' | 'up';
    variant?: 'plain' | 'bordered';
    size?: 'sm' | 'md' | 'lg';
    /** Only for a spot that needs a glyph off the default scale. */
    iconSize?: number;
    pressed?: boolean;
    /** Fill the nearest positioned container with the click area. */
    stretch?: boolean;
    href?: string;
    type?: 'button' | 'submit' | 'reset';
    disabled?: boolean;
    onclick?: (e: MouseEvent) => void;
    onfocus?: (e: FocusEvent) => void;
    class?: string;
    [key: string]: unknown;
  }

  let {
    icon,
    label,
    dir = 'right',
    variant = 'plain',
    size = 'md',
    iconSize,
    pressed,
    stretch = false,
    href,
    type = 'button',
    disabled = false,
    onclick,
    onfocus,
    class: klass = '',
    ...rest
  }: Props = $props();

  /* Glyph sizes that sit comfortably in each circle. */
  const scale = { sm: 14, md: 18, lg: 20 } as const;
  const glyph = $derived(iconSize ?? scale[size]);
  const toggle = $derived(pressed !== undefined);

  /* Read once as focus lands, the same way text fields do. */
  let byKeyboard = $state(false);
  function focused(e: FocusEvent) {
    byKeyboard = modality.keyboard;
    onfocus?.(e);
  }
</script>

{#if href}
  <a
    class="ib {variant} {size} {klass}"
    class:on={pressed}
    class:toggle
    class:stretch
    class:tap={!stretch}
    class:kb={byKeyboard}
    href={disabled ? undefined : href}
    aria-disabled={disabled ? 'true' : undefined}
    aria-label={label}
    onclick={disabled ? undefined : onclick}
    onfocus={focused}
    {...rest}
  >
    <Icon name={icon} size={glyph} fill={pressed} {dir} />
  </a>
{:else}
  <button
    class="ib {variant} {size} {klass}"
    class:on={pressed}
    class:toggle
    class:stretch
    class:tap={!stretch}
    class:kb={byKeyboard}
    {type}
    {disabled}
    aria-label={label}
    aria-pressed={toggle ? pressed : undefined}
    {onclick}
    onfocus={focused}
    {...rest}
  >
    <Icon name={icon} size={glyph} fill={pressed} {dir} />
  </button>
{/if}

<style>
  .ib {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    padding: 0;
    border: 0;
    border-radius: var(--radius-pill);
    background: none;
    color: var(--text-2);
    cursor: pointer;
    text-decoration: none;
    transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease, box-shadow 0.12s ease, transform 0.12s ease;
  }

  /* Three circles: 24, 32 and 40px. */
  .sm { width: 24px; height: 24px; }
  .md { width: 32px; height: 32px; }
  .lg { width: 40px; height: 40px; }

  .plain:hover { background: var(--surface-2); color: var(--text); }

  .bordered { border: 1px solid var(--line); background: var(--surface); }
  /* On hover the circle stays white while the outline and glyph darken, and it
     casts a shadow and lifts a pixel. A darker fill would sink it into the
     page, which is nearly the same color. */
  .bordered:hover { border-color: var(--text-2); color: var(--text); box-shadow: var(--shadow); transform: translateY(-1px); }
  .bordered:active { transform: translateY(0); box-shadow: none; }

  /* A toggle leans towards the accent color on hover, and stays there when on. */
  .toggle:hover { color: var(--accent); }
  .on { color: var(--accent); }

  /* The click area covers the container; the circle is drawn where it sits. */
  .stretch::after { content: ''; position: absolute; inset: 0; }
  /* A moved button would shrink its click area back to the circle mid-hover,
     so a stretched one keeps the shadow but doesn't lift. */
  .stretch:hover { transform: none; }

  .ib:focus-visible { outline: none; }
  .ib.kb:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }

  .ib:disabled,
  .ib[aria-disabled='true'] {
    opacity: 0.6;
    cursor: default;
    pointer-events: none;
  }
</style>
