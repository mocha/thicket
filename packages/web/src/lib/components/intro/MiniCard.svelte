<script lang="ts">
  /**
   * An article card in miniature for the tour's pictures: the site's letter
   * and name, how long ago, and a one-line title. Fixed height, so a picture
   * can make room for one by exactly its size.
   */
  import type { Snippet } from 'svelte';
  import Monogram from '$lib/components/Monogram.svelte';

  let { site, title, time, end, children }: { site: string; title: string; time?: Snippet | string; end?: Snippet; children?: Snippet } = $props();
</script>

<div class="card">
  <div class="top">
    <p class="meta">
      <Monogram name={site} size={16} /><span class="site">{site}</span>
      {#if time}<span aria-hidden="true">·</span><span class="time">{#if typeof time === 'string'}{time}{:else}{@render time()}{/if}</span>{/if}
      {#if end}<span class="end">{@render end()}</span>{/if}
    </p>
    <p class="title">{title}</p>
  </div>
  {@render children?.()}
</div>

<style>
  .card { background: var(--surface); border-radius: var(--radius-sm); box-shadow: var(--shadow); border: var(--card-border, 0); overflow: hidden; }
  .top { box-sizing: border-box; height: var(--mini-card-h, 50px); padding: var(--space-2) var(--space-3) var(--space-3); }
  .meta { display: flex; align-items: center; gap: 6px; margin: 0; font-size: 11px; color: var(--text-2); white-space: nowrap; }
  .site { font-weight: 600; color: var(--text); }
  .end { margin-left: auto; display: flex; }
  .title {
    margin: var(--space-1) 0 0; font-family: var(--font-headings); font-weight: 600; font-size: 14px; line-height: 1.3; color: var(--text);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
</style>
