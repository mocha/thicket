<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';

  /**
   * An inline notice inside a page: something went wrong, or something is
   * worth knowing before you read on. The tone sets the colour and the icon:
   *   error   red     something failed
   *   warning amber   something needs attention soon
   *   info    grey    context, nothing wrong
   *   success green   something worked
   * A dismissible banner shows ✕ and calls `ondismiss`. Remembering the
   * dismissal is the caller's job, because only the caller knows what should
   * bring the banner back.
   */
  type Tone = 'error' | 'warning' | 'info' | 'success';
  let { tone = 'info', title, dismissible = false, ondismiss, children }: {
    tone?: Tone; title?: string; dismissible?: boolean; ondismiss?: () => void; children?: Snippet;
  } = $props();
</script>

<div class="banner {tone}" role={tone === 'error' || tone === 'warning' ? 'alert' : 'status'}>
  <svg class="icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    {#if tone === 'error'}
      <circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5" /><path d="M12 16.5h.01" />
    {:else if tone === 'warning'}
      <path d="M10.3 3.9 2.4 17.6A2 2 0 0 0 4.1 20.6h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4" /><path d="M12 17h.01" />
    {:else if tone === 'success'}
      <circle cx="12" cy="12" r="9" /><path d="m8 12.5 2.8 2.8L16 9.8" />
    {:else}
      <circle cx="12" cy="12" r="9" /><path d="M12 11v5.5" /><path d="M12 7.5h.01" />
    {/if}
  </svg>
  <div class="body">
    {#if title}<p class="title">{title}</p>{/if}
    {#if children}<div class="text">{@render children()}</div>{/if}
  </div>
  {#if dismissible}
    <button class="x" onclick={() => ondismiss?.()} aria-label="Dismiss">
      <Icon name="close" size={16} stroke={2.2} />
    </button>
  {/if}
</div>

<style>
  .banner {
    --tone: var(--text-2);
    display: flex; align-items: flex-start; gap: 10px;
    padding: 11px 12px 11px 14px; border-radius: var(--radius-sm);
    border: 1px solid color-mix(in srgb, var(--tone) 35%, transparent);
    background: color-mix(in srgb, var(--tone) 9%, var(--surface));
    color: var(--text); font-size: calc(14px * var(--size-app)); line-height: 1.45;
  }
  .error { --tone: var(--danger); }
  /* Amber has no theme token yet; mixing it with the text colour darkens it on light grounds and lightens it on dark ones. */
  .warning { --tone: color-mix(in srgb, #c7861a 78%, var(--text)); }
  .success { --tone: var(--accent); }
  .info { --tone: var(--text-3); background: var(--surface-2); border-color: var(--line); }
  .icon { flex: none; margin-top: 1px; color: var(--tone); }
  .info .icon { color: var(--text-2); }
  .body { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .title { margin: 0 0 2px; font-weight: 650; }
  .text :global(a) { color: var(--accent); font-weight: 600; }
  .x { flex: none; display: grid; place-items: center; width: 26px; height: 26px; margin: -3px -4px -3px 0; border-radius: 999px; color: var(--text-3); }
  .x:hover { background: color-mix(in srgb, var(--text) 8%, transparent); color: var(--text); }
</style>
