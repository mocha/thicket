<script lang="ts">
  /** Everything: every post from every feed you follow. The front door lives at /, for everyone. */
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import River from '$lib/components/River.svelte';
  import AddFeedButton from '$lib/components/AddFeedButton.svelte';
  import Button from '$lib/components/Button.svelte';
  import { openAddFeed } from '$lib/addfeed.svelte';
  import StarterPacks from '$lib/components/StarterPacks.svelte';
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
  <div class="nudge"><Banner tone="warning" title="Add an email to your account" href="/account">If you forget your password, an email is the only way back in.</Banner></div>
{:else if emailNudge === 'confirm'}
  <div class="nudge"><Banner tone="info" title="Confirm your email" href="/account">We sent a link to {me?.email}. Until you click it, you can’t reset your password.</Banner></div>
{/if}

{#if brandNew}
  <!-- Following nothing: one centered call to add a first feed, as tall as
       Explore's search box, then the starter collections as the other way in. -->
  <header class="top welcome">
    <h1>Welcome{session.user?.displayName ? `, ${session.user.displayName}` : ''}</h1>
    <p class="sub">Add a feed to start seeing posts here.</p>
    <div class="first">
      <Button variant="primary" size="lg" onclick={() => openAddFeed({ via: 'welcome' })}><span class="plus" aria-hidden="true">+</span> Add your first feed</Button>
    </div>
  </header>
  <hr class="split" />
  <div class="copy-start"><StarterPacks heading="… or get started by copying a collection" lede="" /></div>
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
  .top { margin-bottom: calc(var(--space-5) + var(--space-1)); }
  .titlerow { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); }
  h1 { font-family: var(--font-headings); font-size: calc(var(--text-2xl) * var(--size-headings)); margin: 0; min-width: 0; }
  /* 2px is an optical nudge under the title, not a spacing step. */
  .sub { margin: 2px 0 0; color: var(--text-3); font-size: calc(var(--text-sm) * var(--size-app)); max-width: 62ch; }
  /* The welcome block breathes more than a regular page top: room above the
     headline, a real pause before the button, and a clear break before the
     second way in. */
  .welcome { text-align: center; margin: var(--space-6) 0; }
  .welcome h1 { font-size: calc(var(--text-3xl) * var(--size-headings)); }
  .welcome .sub { margin: var(--space-2) auto 0; color: var(--text-2); font-size: calc(var(--text-xl) * var(--size-app)); }
  .first { margin-top: var(--space-5); }
  /* Serif is kept for the one welcome headline; the second way in reads
     exactly like the line under it. */
  .copy-start :global(.packs h2) { font-family: var(--font); font-size: calc(var(--text-xl) * var(--size-app)); font-weight: 400; color: var(--text-2); }
  /* A short hairline between the two ways in, one and a half cards wide when
     the cards run two across: (row - the gap between cards) × 3/4. */
  .split { width: calc((100% - var(--space-4)) * 0.75); margin: 0 auto var(--space-6); border: 0; border-top: 1px solid var(--line); }
  .plus { font-size: 1.3em; line-height: 1; }
</style>
