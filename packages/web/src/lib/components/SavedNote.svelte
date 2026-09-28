<script lang="ts">
  /**
   * The receipt for a control that saves as you go: a small "Saved" that
   * appears when `show` turns on. The space it sits in is always there and
   * always announced politely, so it never nudges the layout and a screen
   * reader hears it once.
   */
  import Icon from './Icon.svelte';

  let { show }: { show: boolean } = $props();
</script>

<span class="saved" aria-live="polite">
  {#if show}<Icon name="check" size={14} stroke={2.6} />Saved{/if}
</span>

<style>
  .saved { display: inline-flex; align-items: center; gap: var(--space-1); font-size: calc(var(--text-xs) * var(--size-app)); font-weight: 600; color: var(--accent); text-transform: none; letter-spacing: normal; }
</style>
