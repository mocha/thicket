<script lang="ts">
  /**
   * A page's main action, pinned to the bottom while a long list above it
   * scrolls, so it's always in reach. On a phone it sits on top of the tab
   * bar; where the sidebar shows there is no tab bar. Buttons line up at the
   * right; on a phone two long labels stack, main action on top, so pass the
   * main action last. Import's review and the Collections welcome use it.
   */
  import type { Snippet } from 'svelte';
  let { children }: { children: Snippet } = $props();
</script>

<div class="actionbar">{@render children()}</div>

<style>
  .actionbar {
    position: sticky; bottom: calc(var(--nav-h) + var(--safe-b, 0px)); z-index: 5;
    display: flex; justify-content: flex-end; gap: var(--space-2);
    padding: var(--space-3) 0; margin-top: var(--space-2);
    background: var(--bg);
  }
  @media (min-width: 900px) and (min-height: 501px), (min-width: 900px) and (pointer: fine) { .actionbar { bottom: 0; padding-bottom: calc(var(--space-3) + var(--safe-b, 0px)); } }
  @media (max-width: 520px) { .actionbar { flex-direction: column-reverse; } }
</style>
