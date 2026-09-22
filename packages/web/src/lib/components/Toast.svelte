<script lang="ts">
  import { toast, dismissToast } from '$lib/toast.svelte';
</script>

{#if toast.current}
  <div class="toast" role="status">
    <span>{toast.current.message}</span>
    {#if toast.current.action}
      <button class="action" onclick={() => { toast.current?.action?.run(); dismissToast(); }}>{toast.current.action.label}</button>
    {/if}
  </div>
{/if}

<style>
  .toast {
    position: fixed; left: 50%; bottom: calc(var(--nav-h) + var(--safe-b) + var(--space-3)); transform: translateX(-50%);
    display: flex; align-items: center; gap: var(--space-4); max-width: min(92vw, 520px);
    background: var(--text); color: var(--bg); padding: var(--space-3) var(--space-4); border-radius: var(--radius-sm);
    box-shadow: var(--shadow); font-size: calc(var(--text-base) * var(--size-app)); z-index: 50;
  }
  @media (min-width: 900px) { .toast { bottom: var(--space-5); } }
  /* The toast is an inverted chip, so the action word uses the toast color the
     theme picked for that ground, not the page accent (which lands on its own
     background here and disappears). */
  .action { color: var(--toast-accent); font-weight: 600; font-size: calc(var(--text-sm) * var(--size-app)); }
</style>
