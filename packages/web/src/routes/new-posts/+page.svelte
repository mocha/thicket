<script lang="ts">
  import Dot from '$lib/components/Dot.svelte';
  /** New posts (once "Everything", issue #173): every post from every feed you follow. The front door lives at /, for everyone. */
  import { onMount } from 'svelte';
  import { api, type ExploreCollection } from '$lib/api';
  import River from '$lib/components/River.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import AddFeedButton from '$lib/components/AddFeedButton.svelte';
  import Button from '$lib/components/Button.svelte';
  import { openAddFeed } from '$lib/addfeed.svelte';
  import StarterPacks from '$lib/components/StarterPacks.svelte';
  import Welcome from '$lib/components/Welcome.svelte';
  import { session } from '$lib/session.svelte';
  import { loadCollections } from '$lib/collections.svelte';
  import { recall, keepOnLeave } from '$lib/listmemory';
  import { site, loadSite } from '$lib/site.svelte';
  import Banner from '$lib/components/Banner.svelte';
  import ActionBar from '$lib/components/ActionBar.svelte';
  import CopyFailures from '$lib/components/CopyFailures.svelte';
  import { tour, appearanceNote, setAppearanceNote, choices, copyPacks } from '$lib/firstrun.svelte';
  type Stats = { feeds: number; collections: number; posts24h: number; feeds24h: number };
  /** Kept for Back like the list below it, so the line under the title is the same height when the scroll is put back. */
  let stats = $state<Stats | null>(recall<Stats>('everything-stats') ?? null);
  keepOnLeave(() => 'everything-stats', () => stats);
  onMount(() => { if (session.user) { api.event('river_view'); void loadCollections(); api.riverStats().then((s) => (stats = s)).catch(() => {}); } });
  const n = (v: number, one: string, many: string) => `${v} ${v === 1 ? one : many}`;
  /**
   * Following nothing is a different page, not an empty one: it's where a
   * new account starts (THICKET-34). Starter collections to tick, and one
   * button that copies them and fills this page with their posts; importing
   * offered above them for anyone coming from another reader. A site with no
   * public collections at all has nothing to tick, so it offers adding a
   * first site instead.
   */
  const brandNew = $derived(stats !== null && stats.feeds === 0);
  let picked = $state<ExploreCollection[]>([]);
  let available = $state(0);
  let loaded = $state(false);
  const noPacks = $derived(loaded && available === 0);
  let copying = $state(false);
  /** Packs that didn't copy, each with the reason. */
  let failed = $state<{ name: string; why: string }[]>([]);
  async function startReading() {
    if (copying || !picked.length) return;
    copying = true;
    failed = await copyPacks(picked, 'new_posts_welcome');
    picked = [];
    try {
      // The fresh collections are also what starts a new account's tour.
      await Promise.all([loadCollections(true), api.riverStats().then((s) => (stats = s))]);
    } catch (e) {
      console.error('[new posts] reloading after copying starter packs failed:', e);
    } finally {
      copying = false;
    }
  }

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
  {#if failed.length}<div class="nudge"><CopyFailures {failed} /></div>{/if}
  <Welcome title="Welcome{session.user?.displayName ? `, ${session.user.displayName}` : ''}" sub={noPacks ? 'Add a site to start reading' : 'Pick a few to start reading'}>
    <p class="switch">Switching from Feedly or Inoreader? <a href="/import">Import</a></p>
    {#if noPacks}
      <div class="first">
        <Button variant="primary" size="lg" onclick={() => openAddFeed({ via: 'welcome' })}><span class="plus" aria-hidden="true">+</span> Add your first site</Button>
      </div>
    {/if}
  </Welcome>
  <StarterPacks heading="" lede="" bind:picked bind:available bind:loaded />
  {#if available}
    <ActionBar>
      <Button variant="primary" onclick={startReading} disabled={copying || !picked.length}>
        {copying ? 'Copying…' : picked.length ? `Start reading (${picked.length})` : 'Start reading'}
      </Button>
    </ActionBar>
  {/if}
{:else}
  {#if appearanceNote.state === 'show' && !tour.open}
    <!-- After a new account's tour: the appearance choices it skipped, until they're used or this is closed. -->
    <div class="nudge">
      <Banner tone="info" title="Make it yours" dismissible ondismiss={() => setAppearanceNote('done')}>
        Light or dark, color themes, and fonts
        {#snippet actions()}<Button variant="secondary" size="sm" onclick={() => { setAppearanceNote('done'); choices.requested = true; }}>Choose</Button>{/snippet}
      </Banner>
    </div>
  {/if}
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
  <River />
{/if}

<style>
  .nudge { margin-bottom: var(--space-4); }
  .first { margin-top: var(--space-5); }
  .switch { margin: var(--space-3) 0 0; color: var(--text-2); font-size: calc(var(--text-sm) * var(--size-app)); }
  .switch a { color: var(--accent); font-weight: 600; }
  .plus { font-size: 1.3em; line-height: 1; }
</style>
