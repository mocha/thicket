<script lang="ts">
  /** Everything: every post from every feed you follow. The front door lives at /, for everyone. */
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import River from '$lib/components/River.svelte';
  import AddFeedButton from '$lib/components/AddFeedButton.svelte';
  import StarterPacks from '$lib/components/StarterPacks.svelte';
  import { openAddFeed } from '$lib/addfeed.svelte';
  import { session } from '$lib/session.svelte';
  import { loadCollections } from '$lib/collections.svelte';
  import { recall, keepOnLeave } from '$lib/listmemory';
  import { site, loadSite } from '$lib/site.svelte';
  import Banner from '$lib/components/Banner.svelte';
  type Stats = { feeds: number; collections: number; posts24h: number; feeds24h: number };
  /** Kept for Back like the list below it, so the line under the title is the same height when the scroll is put back. */
  let stats = $state<Stats | null>(recall<Stats>('everything-stats') ?? null);
  keepOnLeave(() => 'everything-stats', () => stats);
  onMount(() => { if (session.user) { api.event('river_view'); void loadCollections(); api.riverStats().then((s) => (stats = s)).catch(() => {}); } });
  const n = (v: number, one: string, many: string) => `${v} ${v === 1 ? one : many}`;
  /** Following nothing is a different page, not an empty one: the first screen has to offer a first move. */
  const brandNew = $derived(stats !== null && stats.feeds === 0);
  /**
   * readthicket.com: an account without a confirmed email can't get back in
   * after a forgotten password, so say so here until it has one. Accounts from
   * before email was required have none; new ones are waiting on the link.
   */
  $effect(() => { if (!site.status) void loadSite(); });
  const me = $derived(session.user);
  const emailNudge = $derived(site.status?.hosted && me && !me.emailConfirmedAt ? (me.email ? 'confirm' : 'add') : null);
</script>

{#if emailNudge === 'add'}
  <div class="nudge"><Banner tone="warning" title="Add an email to your account">If you forget your password, an email is the only way back in. <a href="/account">Add one on your Account page</a>.</Banner></div>
{:else if emailNudge === 'confirm'}
  <div class="nudge"><Banner tone="info" title="Confirm your email">We sent a link to {me?.email}. Until you click it, you can’t reset your password. <a href="/account">Resend it from your Account page</a>.</Banner></div>
{/if}

{#if brandNew}
  <header class="top">
    <h1>Welcome{session.user?.displayName ? `, ${session.user.displayName}` : ''}.</h1>
    <p class="sub">You aren’t following anything, yet. Once you are, new posts will show up here in chronological order. We never curate the content you see.</p>
  </header>
  <div class="start">
    <StarterPacks />
    <p class="own">Already know a site you want? <button type="button" onclick={() => openAddFeed({ via: 'welcome' })}>Add it by its address</button> — a blog, a newspaper, a newsletter, a YouTube channel. If it publishes a feed, and most do, thicket will find it.</p>
  </div>
{:else}
  <header class="top">
    <div class="titlerow">
      <h1>Everything</h1>
      <AddFeedButton via="all_collections" />
    </div>
    {#if stats}
      <p class="sub">{n(stats.feeds, 'feed', 'feeds')} · {n(stats.collections, 'collection', 'collections')} · {#if stats.posts24h}{n(stats.posts24h, 'new post', 'new posts')} in the last 24 hours{:else}No new posts in the last 24 hours{/if}</p>
    {:else}
      <p class="sub">Posts from every feed you follow, newest first.</p>
    {/if}
  </header>
  <River />
{/if}

<style>
  .nudge { margin-bottom: var(--space-4); }
  .nudge a { color: var(--accent); font-weight: 600; }
  .top { margin-bottom: calc(var(--space-5) + var(--space-1)); }
  .titlerow { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); }
  h1 { font-family: var(--font-headings); font-size: calc(var(--text-2xl) * var(--size-headings)); margin: 0; min-width: 0; }
  /* 2px is an optical nudge under the title, not a spacing step. */
  .sub { margin: 2px 0 0; color: var(--text-3); font-size: calc(var(--text-sm) * var(--size-app)); max-width: 62ch; }
  .start { display: flex; flex-direction: column; gap: var(--space-5); margin-top: var(--space-5); }
  .own { margin: 0; padding-top: var(--space-4); border-top: 1px solid var(--line); color: var(--text-2); font-size: calc(var(--text-base) * var(--size-app)); max-width: 62ch; line-height: 1.5; }
  .own button { color: var(--accent); font-weight: 600; font: inherit; font-weight: 600; }
  .own button:hover { text-decoration: underline; }
</style>
