<script lang="ts">
  /**
   * A page of the marketing site that isn't the landing page (About,
   * Contact): the landing page's green and fronds, the page's words in one
   * reading column, and the shared footer. readthicket.com only, like the
   * landing page: a self-hosted copy sends visitors back to its front page.
   */
  import type { Snippet } from 'svelte';
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { site, loadSite } from '$lib/site.svelte';
  import HeroForest from './HeroForest.svelte';
  import MarketingFooter from './MarketingFooter.svelte';

  /** `wide`: a broader column, for a page that sets pictures beside its words. Paragraphs of plain reading keep the usual measure. */
  let { children, wide = false }: { children: Snippet; wide?: boolean } = $props();

  onMount(async () => {
    const s = await loadSite();
    if (!s.hosted) void goto('/', { replaceState: true });
  });
</script>

{#if site.status?.hosted}
  <div class="top" style:--column={wide ? '56rem' : null}>
    <HeroForest picture={false}>
      {#snippet pitch()}<div class="page">{@render children()}</div>{/snippet}
      {#snippet below()}<MarketingFooter />{/snippet}
    </HeroForest>
  </div>
{/if}

<style>
  /* The green starts right under the line below the logo, as on the landing page. */
  .top { margin-top: calc(-1 * var(--space-5)); }
  /* What every marketing page's words share. The one serif headline is styled by the green section itself. */
  .page :global(h1) { font-family: var(--font-headings); font-size: clamp(34px, 5vw, 52px); line-height: 1.15; margin: 0 0 var(--space-5); letter-spacing: -0.015em; }
  .page :global(h2) { font-size: calc(var(--text-xl) * var(--size-app)); font-weight: 700; line-height: 1.25; margin: 0 0 var(--space-4); }
  .page :global(h3) { font-size: calc(var(--text-base) * var(--size-app)); font-weight: 700; margin: 0 0 var(--space-1); }
  .page :global(p) { margin: 0 0 var(--space-4); font-size: calc(var(--text-reading) * var(--size-app)); line-height: 1.55; text-wrap: pretty; }
  .page > :global(p) { max-width: 42rem; }
  .page :global(section) { margin-top: calc(var(--space-6) * 2); }
  /* Links in full cream and underlined: the usual green disappears on the green. */
  .page :global(a:not(.btn)) { color: #f6f1e8; font-weight: 600; text-decoration: underline; text-underline-offset: 3px; }
</style>
