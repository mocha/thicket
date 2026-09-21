<script lang="ts">
  import Icon from './Icon.svelte';

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
   */
  interface Props {
    icon: 'gear' | 'pencil' | 'close' | 'caret' | 'back' | 'dots' | 'bookmark' | 'note';
    label: string;
    variant?: 'plain' | 'bordered';
    size?: 'sm' | 'md' | 'lg';
    /** Only for a spot that needs a glyph off the default scale. */
    iconSize?: number;
    pressed?: boolean;
    href?: string;
    type?: 'button' | 'submit' | 'reset';
    disabled?: boolean;
    onclick?: (e: MouseEvent) => void;
    class?: string;
    [key: string]: unknown;
  }

  let {
    icon,
    label,
    variant = 'plain',
    size = 'md',
    iconSize,
    pressed,
    href,
    type = 'button',
    disabled = false,
    onclick,
    class: klass = '',
    ...rest
  }: Props = $props();

  /* Glyph sizes that sit comfortably in each circle. */
  const scale = { sm: 14, md: 18, lg: 20 } as const;
  const glyph = $derived(iconSize ?? scale[size]);
  const toggle = $derived(pressed !== undefined);
</script>

{#if href}
  <a
    class="ib {variant} {size} {klass}"
    class:on={pressed}
    class:toggle
    href={disabled ? undefined : href}
    aria-disabled={disabled ? 'true' : undefined}
    aria-label={label}
    onclick={disabled ? undefined : onclick}
    {...rest}
  >
    <Icon name={icon} size={glyph} fill={pressed} />
  </a>
{:else}
  <button
    class="ib {variant} {size} {klass}"
    class:on={pressed}
    class:toggle
    {type}
    {disabled}
    aria-label={label}
    aria-pressed={toggle ? pressed : undefined}
    {onclick}
    {...rest}
  >
    <Icon name={icon} size={glyph} fill={pressed} />
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
    transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease;
  }

  /* Three circles: 24, 32 and 40px. */
  .sm { width: 24px; height: 24px; }
  .md { width: 32px; height: 32px; }
  .lg { width: 40px; height: 40px; }

  .plain:hover { background: var(--surface-2); color: var(--text); }

  .bordered { border: 1px solid var(--line); background: var(--surface); }
  .bordered:hover { background: var(--surface-2); color: var(--text); }

  /* A toggle leans towards the accent color on hover, and stays there when on. */
  .toggle:hover { color: var(--accent); }
  .on { color: var(--accent); }

  .ib:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }

  .ib:disabled,
  .ib[aria-disabled='true'] {
    opacity: 0.6;
    cursor: default;
    pointer-events: none;
  }
</style>
