<script lang="ts">
  /**
   * The share target and deep link. /add?url=… (or text=… from apps that put
   * the link there) opens the Add sheet prefilled and submits it; ?c=ID
   * preselects a collection. Closing the sheet from here goes home.
   */
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { openAddFeed } from '$lib/addfeed.svelte';

  onMount(() => {
    const q = page.url.searchParams;
    const shared = q.get('url') || q.get('text')?.match(/https?:\/\/\S+/)?.[0] || '';
    const c = q.get('c');
    openAddFeed({ url: shared, collectionIds: c ? [Number(c)] : [], via: shared ? 'share' : 'link', autoSubmit: !!shared });
  });
</script>

<h1>Add a feed</h1>
<p class="lede">Paste the address of a site, a blog, or a feed.</p>

<style>
  h1 { font-family: var(--font-headings); font-size: calc(26px * var(--size-headings)); margin: 0 0 6px; }
  .lede { color: var(--text-2); margin: 0; }
</style>
