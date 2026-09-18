<script lang="ts">
  /** Signed in: Everything, your whole stream. Signed out: the front door. */
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import River from '$lib/components/River.svelte';
  import Home from '$lib/components/Home.svelte';
  import StarterPacks from '$lib/components/StarterPacks.svelte';
  import { openAddFeed } from '$lib/addfeed.svelte';
  import { session } from '$lib/session.svelte';
  import { loadCollections } from '$lib/collections.svelte';
  let stats = $state<{ feeds: number; collections: number; posts24h: number; feeds24h: number } | null>(null);
  onMount(() => { if (session.user) { api.event('river_view'); void loadCollections(); api.riverStats().then((s) => (stats = s)).catch(() => {}); } });
  const n = (v: number, one: string, many: string) => `${v} ${v === 1 ? one : many}`;
  /** Following nothing is a different page, not an empty one: the first screen has to offer a first move. */
  const brandNew = $derived(stats !== null && stats.feeds === 0);
</script>

{#if session.user}
  {#if brandNew}
    <header class="top">
      <h1>Welcome{session.user.displayName ? `, ${session.user.displayName}` : ''}.</h1>
      <p class="sub">You aren't following anything yet, so this is where your stream will be. Nothing is ranked here and nothing is inserted: you'll see what the sites you choose publish, newest first.</p>
    </header>
    <div class="start">
      <StarterPacks />
      <p class="own">Already know a site you want? <button type="button" onclick={() => openAddFeed({ via: 'welcome' })}>Add it by its address</button> — a blog, a newspaper, a newsletter, a YouTube channel. If it publishes a feed, and most do, thicket will find it.</p>
    </div>
  {:else}
    <header class="top">
      <div class="titlerow">
        <h1>Everything</h1>
        <button class="btn" onclick={() => openAddFeed({ via: 'all_collections' })}><span aria-hidden="true">+</span> Add new feed</button>
      </div>
      {#if stats}
        <p class="sub">{n(stats.feeds, 'feed', 'feeds')} · {n(stats.collections, 'collection', 'collections')} · {#if stats.posts24h}{n(stats.posts24h, 'new post', 'new posts')} in the last 24 hours{:else}No new posts in the last 24 hours{/if}</p>
      {:else}
        <p class="sub">Posts from every feed you follow, newest first.</p>
      {/if}
    </header>
    <River />
  {/if}
{:else}
  <Home />
{/if}

<style>
  .top { margin-bottom: 28px; }
  .titlerow { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
  h1 { font-family: var(--font-headings); font-size: calc(28px * var(--size-headings)); margin: 0; min-width: 0; }
  /* The primary call to action: the solid green pill Explore's "add" button uses. */
  .btn { flex: none; padding: 9px 14px; border-radius: 999px; border: 1px solid transparent; background: var(--accent); font-size: calc(14px * var(--size-app)); font-weight: 600; color: var(--accent-ink); white-space: nowrap; }
  .btn:hover { background: color-mix(in srgb, var(--accent) 88%, black); }
  .sub { margin: 2px 0 0; color: var(--text-3); font-size: calc(14px * var(--size-app)); max-width: 62ch; }
  .start { display: flex; flex-direction: column; gap: 22px; margin-top: 22px; }
  .own { margin: 0; padding-top: 18px; border-top: 1px solid var(--line); color: var(--text-2); font-size: calc(15px * var(--size-app)); max-width: 62ch; line-height: 1.5; }
  .own button { color: var(--accent); font-weight: 600; font: inherit; font-weight: 600; }
  .own button:hover { text-decoration: underline; }
</style>
