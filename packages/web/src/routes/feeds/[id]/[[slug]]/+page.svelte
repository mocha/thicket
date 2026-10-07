<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { afterNavigate, replaceState } from '$app/navigation';
  import { api, feedHref, type Feed } from '$lib/api';
  import { feedName } from '$lib/feedname';
  import { dismissNotice, hiddenContent, noticeDismissed } from '$lib/feedsettings';
  import { feedOrigin, longAgo, webHref } from '$lib/time';
  import SourceIcon from '$lib/components/SourceIcon.svelte';
  import River from '$lib/components/River.svelte';
  import FollowControl from '$lib/components/FollowControl.svelte';
  import IconButton from '$lib/components/IconButton.svelte';
  import Banner from '$lib/components/Banner.svelte';
  import Badge from '$lib/components/Badge.svelte';
  import BackLink from '$lib/components/BackLink.svelte';
  import { cameFrom as wayBack, keepCameFrom } from '$lib/wayback.svelte';
  import { session } from '$lib/session.svelte';

  /**
   * A feed on its own terms: who they are, how active, whether I follow them,
   * and everything they've posted as a single-feed river. Exists independent
   * of any user, which is what makes it the unit of discovery.
   * URL is /feeds/:id/:slug; the id is canonical, the slug is corrected in place.
   * Refreshing by hand lives on the settings page now, as a diagnostic.
   * Above the name is the way back to the page you came from, or to Explore
   * when you arrived from outside. Signed out it is the same page without
   * Follow, Settings or the way back; how far back a visitor can read is the
   * instance's setting.
   */
  const id = $derived(Number(page.params.id));
  let feed = $state<Feed | null>(null);
  let ids = $state<number[]>([]);
  let loadedId = $state<number | undefined>(undefined);

  /** What my settings leave out of this feed, in words. Empty when nothing is hidden. */
  const hidden = $derived(feed ? hiddenContent(feed) : []);
  let dismissed = $state(false);

  async function loadFeed() {
    feed = await api.feed(id);
    ids = feed.myCollectionIds;
    dismissed = noticeDismissed(feed.id, hiddenContent(feed));
    if (page.params.slug !== feed.slug) replaceState(feedHref(feed) + page.url.search, page.state);
  }

  onMount(() => api.event('feed_view', { feedId: id }));

  /** Another view of this same feed (its settings, one of its posts) isn't a way back. */
  afterNavigate((nav) => keepCameFrom(nav, (from) => from.pathname === `/feeds/${id}` || from.pathname.startsWith(`/feeds/${id}/`) || from.pathname === '/add'));
  const cameFrom = $derived(wayBack());

  $effect(() => {
    if (loadedId === id) return;
    loadedId = id;
    feed = null;
    void loadFeed();
  });
</script>

<svelte:head><title>{feed ? feedName(feed) : 'Feed'} · thicket</title></svelte:head>

{#if session.user}<nav class="crumbs"><BackLink href={cameFrom?.href ?? '/explore'} label={cameFrom?.name ?? 'Explore'} stepBack={!!cameFrom} /></nav>{/if}

{#if feed}
  <header class="profile">
    <SourceIcon feedId={feed.id} hasIcon={feed.hasIcon} name={feedName(feed)} size={64} />
    <div class="who">
      <div class="titlerow">
        <h1>{feedName(feed)}</h1>
        {#if session.user}
          <div class="actions">
            <FollowControl feedId={feed.id} bind:ids name={feedName(feed)} onchange={() => void loadFeed()} />
            <IconButton icon="gear" variant="bordered" size="lg" href="/feeds/{feed.id}/settings" label="Settings" title="Settings" />
          </div>
        {/if}
      </div>
      <div class="addr">
        <a class="host tap" href={webHref(feed.siteUrl) ?? webHref(feed.url) ?? '#'} target="_blank" rel="noopener">{feedOrigin(feed)} ↗</a>
        {#if feed.requiresSubscription}<Badge title="Posts from this site are behind a paywall: reading them takes a subscription">Requires subscription</Badge>{/if}
      </div>
      {#if feed.description}<p class="desc">{feed.description}</p>{/if}
    </div>
  </header>

  <dl class="stats">
    <div><dt>Last post</dt><dd>{feed.lastItemAt ? longAgo(feed.lastItemAt) : '—'}</dd></div>
    <div><dt>Last 30 days</dt><dd>{feed.postsLast30d}</dd></div>
    <div><dt>Users following</dt><dd>{feed.followerCount}</dd></div>
    {#if feed.repeatsLast30d > 0}
      <div title="Posts in the last 30 days that appear to repeat an earlier post from this feed">
        <dt>Repeats, 30 days</dt>
        <dd>{feed.repeatsLast30d}{#if feed.postsLast30d > 0}<small> · {Math.round((100 * feed.repeatsLast30d) / feed.postsLast30d)}%</small>{/if}</dd>
      </div>
    {/if}
  </dl>

  {#if feed.consecutiveFailures > 0 || (hidden.length > 0 && !dismissed)}
    <div class="banners">
      {#if feed.consecutiveFailures > 0}
        <Banner tone="error">Last fetch failed: {feed.lastError ?? `HTTP ${feed.lastStatus}`}</Banner>
      {/if}
      {#if hidden.length > 0 && !dismissed}
        <Banner tone="info" dismissible ondismiss={() => { if (feed) dismissNotice(feed.id, hidden); dismissed = true; }}>
          Your settings are modifying how this feed is being displayed: {hidden.join('; ')}. <a href="/feeds/{feed.id}/settings">Change</a>
        </Banner>
      {/if}
    </div>
  {/if}
{:else}
  <p class="status">Loading…</p>
{/if}

<div class="river">
  <River feed={id} showSource={false} emptyTitle="No posts yet" emptyBody={feed && !feed.lastFetchedAt ? 'This feed hasn’t been fetched yet.' : 'Nothing has come through from this feed so far.'} emptyAction={null} />
</div>

<style>
  .crumbs { font-size: calc(var(--text-sm) * var(--size-app)); margin-bottom: var(--space-2); }
  .profile { display: flex; gap: var(--space-4); align-items: flex-start; }
  .who { flex: 1; min-width: 0; }
  /* The title takes what room it needs; the buttons sit to its right and drop underneath when the row runs out. */
  .titlerow { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: var(--space-2) var(--space-3); }
  h1 { flex: 1 1 auto; min-width: 0; font-family: var(--font-headings); font-size: calc(var(--text-2xl) * var(--size-headings)); margin: 0; line-height: 1.15; overflow-wrap: anywhere; }
  .actions { display: flex; flex-wrap: wrap; gap: var(--space-2); align-items: center; flex: 0 1 auto; max-width: 100%; }
  /* 2px is an optical nudge under the title, not a spacing step. */
  .host { display: inline-block; max-width: 100%; overflow-wrap: anywhere; margin-top: 2px; font-size: calc(var(--text-sm) * var(--size-app)); color: var(--accent); font-weight: 600; }
  /* The site link sits right under the follow and settings buttons, so its
     touch area grows downward only and leaves theirs whole. */
  @media (pointer: coarse) { .host::after { top: 0; } }
  /* The address, and beside it "Requires subscription" when the site is paywalled; the pill drops under the address when the line runs out. */
  .addr { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-1) var(--space-2); }
  /* On a phone the buttons fold under the address and description, so the
     title keeps the full width. */
  @media (max-width: 600px) {
    .who { display: flex; flex-direction: column; align-items: flex-start; }
    .titlerow { display: contents; }
    h1 { flex: none; }
    .actions { order: 1; margin-top: var(--space-3); }
  }
  .desc { margin: var(--space-2) 0 0; font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); }
  /* 132px is the narrowest column that keeps the longest label, "Users following", on one line. */
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(132px, 1fr)); gap: var(--space-3) var(--space-2); margin: var(--space-4) 0 0; padding: var(--space-3) 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
  /* 2px between a label and its number is optical, not a spacing step. */
  .stats div { display: flex; flex-direction: column; gap: 2px; }
  dt { font-size: calc(var(--text-xs) * var(--size-app)); text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-2); }
  dd { margin: 0; font-weight: 600; font-size: calc(var(--text-base) * var(--size-app)); }
  .banners { display: flex; flex-direction: column; gap: var(--space-2); margin-top: var(--space-4); }
  .river { margin-top: var(--space-4); }
  .status { text-align: center; color: var(--text-2); font-size: calc(var(--text-sm) * var(--size-app)); padding: var(--space-4) 0; margin: 0; }
</style>
