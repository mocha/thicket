<script lang="ts">
  import type { Snippet } from 'svelte';

  /**
   * The one button. Renders a <button>, or an <a> when given href. Three looks
   * (primary / ghost / danger) and two sizes, all built on the shared spacing,
   * type, and colour tokens so every button in the app matches by default.
   */
  interface Props {
    variant?: 'primary' | 'ghost' | 'danger';
    size?: 'sm' | 'md';
    solid?: boolean;
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
    class="btn {variant} {size}"
    class:loading
    class:solid
    href={off ? undefined : href}
    aria-disabled={off ? 'true' : undefined}
    onclick={off ? undefined : onclick}
    {...rest}
  >
    {#if loading}<span class="spin" aria-hidden="true"></span>{/if}
    {@render children()}
  </a>
{:else}
  <button class="btn {variant} {size}" class:loading class:solid {type} disabled={off} {onclick} {...rest}>
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
    white-space: nowrap;
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

  .btn.primary {
    background: var(--accent);
    color: var(--accent-ink);
    border-color: var(--accent);
  }
  .btn.primary:hover {
    background: color-mix(in srgb, var(--accent) 84%, #000);
    border-color: color-mix(in srgb, var(--accent) 84%, #000);
    color: var(--accent-ink);
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
    color: #fff;
  }
  .btn.danger.solid:hover {
    background: color-mix(in srgb, var(--danger) 84%, #000);
    border-color: color-mix(in srgb, var(--danger) 84%, #000);
    color: #fff;
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
