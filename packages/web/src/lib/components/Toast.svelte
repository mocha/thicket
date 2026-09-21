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
    position: fixed; left: 50%; bottom: calc(var(--nav-h) + var(--safe-b) + 12px); transform: translateX(-50%);
    display: flex; align-items: center; gap: 16px; max-width: min(92vw, 520px);
    background: var(--text); color: var(--bg); padding: 12px 16px; border-radius: 12px;
    box-shadow: var(--shadow); font-size: calc(var(--text-base) * var(--size-app)); z-index: 50;
  }
  @media (min-width: 900px) { .toast { bottom: 20px; } }
  .action { color: var(--accent); font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; font-size: calc(var(--text-xs) * var(--size-app)); }
  @media (prefers-color-scheme: dark) { .action { color: #a5d9ae; } }
</style>
