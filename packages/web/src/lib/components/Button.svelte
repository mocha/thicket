<script lang="ts">
  import type { Snippet } from 'svelte';

  /**
   * The one button. Renders a <button>, or an <a> when given href. Four looks
   * (primary / secondary / ghost / danger) and three sizes, all built on the shared spacing,
   * type, and color tokens so every button in the app matches by default.
   * `link` strips the pill down to its words, for a secondary action that
   * should sit quietly beside the main one (Unfollow under Done). It keeps the
   * variant's color, so `variant="danger" link` is a red text button.
   */
  interface Props {
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
    size?: 'sm' | 'md' | 'lg';
    solid?: boolean;
    link?: boolean;
    href?: string;
    type?: 'button' | 'submit' | 'reset';
    disabled?: boolean;
    loading?: boolean;
    onclick?: (e: MouseEvent) => void;
    children: Snippet;
    [key: string]: unknown;
  }

  let {
    variant = 'ghost',
    size = 'md',
    solid = false,
    link = false,
    href,
    type = 'button',
    disabled = false,
    loading = false,
    onclick,
    children,
    ...rest
  }: Props = $props();

  // Loading counts as off: it should neither click through nor follow a link.
  const off = $derived(disabled || loading);
</script>

{#if href}
  <a
    class="btn tap {variant} {size}"
    class:loading
    class:solid
    class:link
    href={off ? undefined : href}
    aria-disabled={off ? 'true' : undefined}
    onclick={off ? undefined : onclick}
    {...rest}
  >
    {#if loading}<span class="spin" aria-hidden="true"></span>{/if}
    {@render children()}
  </a>
{:else}
  <button class="btn tap {variant} {size}" class:loading class:solid class:link {type} disabled={off} {onclick} {...rest}>
    {#if loading}<span class="spin" aria-hidden="true"></span>{/if}
    {@render children()}
  </button>
{/if}

<style>
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-pill);
    border: 1px solid var(--line);
    background: var(--surface);
    font-family: inherit;
    font-size: calc(var(--text-sm) * var(--size-app));
    font-weight: 600;
    color: var(--text-2);
    /* One line, always, unless the label alone is wider than the space the
       button sits in (large text on a small phone). Then it wraps rather than
       pushing the page sideways. It never shrinks to make room for a
       neighbor, so in a row it stays on one line as before. */
    flex-shrink: 0;
    max-width: 100%;
    text-align: center;
    text-wrap: balance;
    cursor: pointer;
    text-decoration: none;
    transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease, box-shadow 0.12s ease, transform 0.12s ease;
  }
  .btn:hover {
    background: var(--surface-2);
    color: var(--text);
    box-shadow: var(--shadow);
    transform: translateY(-1px);
  }
  .btn:active {
    transform: translateY(0);
    box-shadow: none;
  }
  .btn.sm {
    padding: var(--space-1) var(--space-3);
  }
  .btn.lg {
    padding: var(--space-3) var(--space-5);
    font-size: calc(var(--text-base) * var(--size-app));
  }
  /* A text box's text never drops under 16px on a touchscreen (see Input), so
     the large size, which sits beside one, keeps the same floor and the two
     stay the same height. */
  @media (pointer: coarse) {
    .btn.lg { font-size: max(16px, calc(var(--text-base) * var(--size-app))); }
  }

  .btn.primary {
    background: var(--accent);
    color: var(--accent-ink);
    border-color: var(--accent);
  }
  /* Deliberately literal: the #000 here is not a color of its own, it is the
     darkening step that presses the accent and the red down on hover. */
  .btn.primary:hover {
    background: color-mix(in srgb, var(--accent) 84%, #000);
    border-color: color-mix(in srgb, var(--accent) 84%, #000);
    color: var(--accent-ink);
  }

  /* Secondary: the same move as primary, turned down, for when a screen offers
     it more than once (one per card) and a row of solid fills would shout.
     A pale wash of the accent; hover keeps the wash and lifts like the rest. */
  .btn.secondary {
    background: var(--accent-soft);
    color: var(--accent-soft-ink);
    border-color: var(--accent-soft-line, var(--accent-soft));
  }
  .btn.secondary:hover {
    background: var(--accent-soft);
    color: var(--accent-soft-ink);
  }

  .btn.danger {
    color: var(--danger);
    border-color: color-mix(in srgb, var(--danger) 40%, transparent);
  }
  .btn.danger:hover {
    background: color-mix(in srgb, var(--danger) 10%, transparent);
    color: var(--danger);
  }

  /* Solid danger: the filled red used for a final destructive confirm. */
  .btn.danger.solid {
    background: var(--danger);
    border-color: var(--danger);
    color: var(--danger-ink);
  }
  .btn.danger.solid:hover {
    background: color-mix(in srgb, var(--danger) 84%, #000);
    border-color: color-mix(in srgb, var(--danger) 84%, #000);
    color: var(--danger-ink);
  }

  /* Link: just the words. Color comes from the variant; ghost reads as accent. */
  .btn.link {
    background: none;
    border-color: transparent;
    padding: var(--space-1) var(--space-2);
    color: var(--accent);
    /* A link can carry a name ("Unfollow The Long Feed Title"), so it wraps. */
    white-space: normal;
    text-align: center;
  }
  .btn.link.danger {
    color: var(--danger);
  }
  .btn.link:hover {
    background: none;
    box-shadow: none;
    transform: none;
    text-decoration: underline;
    text-underline-offset: 0.2em;
  }

  .btn:disabled,
  .btn[aria-disabled='true'] {
    opacity: 0.6;
    cursor: default;
    pointer-events: none;
  }

  .spin {
    width: 0.9em;
    height: 0.9em;
    border-radius: 50%;
    border: 2px solid currentColor;
    border-top-color: transparent;
    animation: btn-spin 0.6s linear infinite;
  }
  @keyframes btn-spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
