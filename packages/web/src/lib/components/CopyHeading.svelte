<script lang="ts">
  import Dot from '$lib/components/Dot.svelte';
  /**
   * The top of the sign-up and log-in pages. Arriving from Copy on someone's
   * collection, it names what you're about to get ("Sign up to copy",
   * the collection, whose it is); otherwise it's the page's plain heading.
   * If the collection can't be found, the plain heading shows.
   */
  import { profilesApi, type PublicCollection } from '$lib/api';
  import { copyTarget } from '$lib/copyintent.svelte';

  let { next, action, heading }: { next: string | null; action: string; heading: string } = $props();

  const target = $derived(copyTarget(next));
  let col = $state<PublicCollection | null>(null);
  // Until the collection has been looked up, no heading at all, so the plain one doesn't flash first.
  let waiting = $state(false);
  $effect(() => {
    col = null;
    waiting = !!target;
    if (target) profilesApi.collection(target.handle, target.slug).then((c) => (col = c)).catch(() => {}).finally(() => (waiting = false));
  });
</script>

{#if waiting}
  <div class="wait" aria-hidden="true"></div>
{:else if col}
  <p class="eyebrow">{action} to copy</p>
  <h1>{col.name}</h1>
  <p class="by">by {col.owner.displayName ?? `@${col.owner.handle}`} <Dot /> {col.feeds.length === 1 ? '1 feed' : `${col.feeds.length} feeds`}</p>
{:else}
  <h1>{heading}</h1>
{/if}

<style>
  .eyebrow { margin: 0 0 var(--space-1); font-size: calc(var(--text-xs) * var(--size-app)); text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-2); font-weight: 600; }
  h1 { font-family: var(--font-headings); font-size: calc(var(--text-2xl) * var(--size-headings)); margin: 0 0 var(--space-5); overflow-wrap: anywhere; }
  .eyebrow + h1 { margin-bottom: var(--space-1); }
  .wait { height: calc(var(--text-2xl) * var(--size-headings) * 1.25 + var(--space-5)); }
  .by { color: var(--text-2); margin: 0 0 var(--space-5); font-size: calc(var(--text-sm) * var(--size-app)); }
</style>
