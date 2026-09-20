<script lang="ts">
  /**
   * The frame for the terms, privacy and refund pages: public, plain, with
   * the instance's own name filled in. The operator's legal name and contact
   * are the two things every instance must set for itself; they come from
   * the operator settings below and read as placeholders until they do.
   */
  import { onMount } from 'svelte';
  import { authApi, type InstanceStatus } from '$lib/api';
  import type { Snippet } from 'svelte';

  let { title, updated, children }: { title: string; updated: string; children: Snippet<[{ name: string; url: string }]> } = $props();
  let status = $state<InstanceStatus | null>(null);
  onMount(async () => { status = await authApi.status().catch(() => null); });
  const name = $derived(status?.name ?? 'this instance');
  const url = $derived(status?.url ?? '');
</script>

<svelte:head><title>{title} · {name}</title></svelte:head>

<article class="legal">
  <header class="top">
    <h1>{title}</h1>
    <p class="meta">Last updated {updated} · <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a> · <a href="/refunds">Refunds</a> · <a href="/pricing">Pricing</a></p>
  </header>
  {@render children({ name, url })}
</article>

<style>
  .legal { max-width: 68ch; }
  .top { margin-bottom: 18px; }
  .meta { color: var(--text-2); font-size: calc(14px * var(--size-app)); margin: 4px 0 0; }
  .legal :global(h2) { font-size: calc(20px * var(--size-app)); margin: 26px 0 8px; }
  .legal :global(p), .legal :global(li) { color: var(--text); line-height: 1.5; font-size: calc(16px * var(--size-app)); }
  .legal :global(p) { margin: 0 0 12px; }
  .legal :global(ul) { margin: 0 0 12px; padding-left: 20px; }
  .legal :global(.placeholder) { background: var(--surface-2); padding: 0 4px; border-radius: 4px; }
</style>
