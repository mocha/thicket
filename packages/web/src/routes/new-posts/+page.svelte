<script lang="ts">
  import Dot from '$lib/components/Dot.svelte';
  /** New posts (once "Everything", issue #173): every post from every feed you follow. The front door lives at /, for everyone. */
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import River from '$lib/components/River.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import AddFeedButton from '$lib/components/AddFeedButton.svelte';
  import StarterWelcome from '$lib/components/StarterWelcome.svelte';
  import CopyFailures from '$lib/components/CopyFailures.svelte';
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
  /** Starter collections that didn't copy, each with why, said above the posts that replace the welcome. */
  let failed = $state<{ name: string; why: string }[]>([]);
  /**
   * readthicket.com: an account without a confirmed email can't get back in
   * after a forgotten password, so say so here until it has one. Accounts from
   * before email was required have none; new ones are waiting on the link.
   */
  $effect(() => { if (!site.status) void loadSite(); });
  const me = $derived(session.user);
  const emailNudge = $derived(site.status?.hosted && me && !me.emailConfirmedAt ? (me.email ? 'confirm' : 'add') : null);
</script>

<svelte:head><title>New posts · thicket</title></svelte:head>

{#if emailNudge === 'add'}
  <div class="nudge"><Banner tone="warning" title="Add an email to your account" href="/settings?tab=account">If you forget your password, an email is the only way back in.</Banner></div>
{:else if emailNudge === 'confirm'}
  <div class="nudge"><Banner tone="info" title="Confirm your email" href="/settings?tab=account">We sent a link to {me?.email}. Until you click it, you can’t reset your password.</Banner></div>
{/if}

{#if brandNew}
  <!-- Following nothing: the starting screen Collections shares, under this page's title. -->
  <StarterWelcome title="New posts" sub="If you want an easy way to get started, copy one or more of these Collections." via="welcome" oncopied={(f) => { failed = f; return Promise.all([loadCollections(true), api.riverStats().then((s) => (stats = s))]); }} />
{:else}
  <PageHeader name="New posts">
    {#snippet description()}
      {#if stats}
        {n(stats.feeds, 'feed', 'feeds')} <Dot /> {n(stats.collections, 'collection', 'collections')} <Dot /> {#if stats.posts24h}{n(stats.posts24h, 'new post', 'new posts')} in 24 hours{:else}No new posts in 24 hours{/if}
      {:else}
        Posts from every feed you follow, newest first.
      {/if}
    {/snippet}
    {#snippet actions()}<AddFeedButton via="all_collections" bottomBarOnly />{/snippet}
  </PageHeader>
  {#if failed.length}<div class="nudge"><CopyFailures {failed} /></div>{/if}
  <River />
{/if}

<style>
  .nudge { margin-bottom: var(--space-4); }
</style>
