<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { replaceState } from '$app/navigation';
  import { api, feedHref, type Feed } from '$lib/api';
  import { feedName } from '$lib/feedname';
  import { dismissNotice, hiddenContent, noticeDismissed } from '$lib/feedsettings';
  import { feedOrigin, longAgo } from '$lib/time';
  import SourceIcon from '$lib/components/SourceIcon.svelte';
  import River from '$lib/components/River.svelte';
  import FollowButton from '$lib/components/FollowButton.svelte';
  import IconButton from '$lib/components/IconButton.svelte';
  import Banner from '$lib/components/Banner.svelte';
  import { session } from '$lib/session.svelte';

  /**
   * A feed on its own terms: who they are, how active, whether I follow them,
   * and everything they've posted as a single-feed river. Exists independent
   * of any user, which is what makes it the unit of discovery.
   * URL is /feeds/:id/:slug; the id is canonical, the slug is corrected in place.
   * Refreshing by hand lives on the settings page now, as a diagnostic.
   * Signed out it is the same page without Follow, Settings or the way to
   * Explore; how far back a visitor can read is the instance's setting.
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
    if (page.params.slug !== feed.slug) replaceState(feedHref(feed) + page.url.search, {});
  }

  onMount(() => api.event('feed_view', { feedId: id }));

  $effect(() => {
    if (loadedId === id) return;
    loadedId = id;
    feed = null;
    void loadFeed();
  });
</script>

{#if session.user}<nav class="crumbs"><a href="/explore">Explore</a> <span aria-hidden="true">›</span></nav>{/if}

{#if feed}
  <header class="profile">
    <SourceIcon feedId={feed.id} hasIcon={feed.hasIcon} name={feedName(feed)} size={64} />
    <div class="who">
      <div class="titlerow">
        <h1>{feedName(feed)}</h1>
        {#if session.user}
          <div class="actions">
            <FollowButton feedId={feed.id} bind:ids name={feedName(feed)} onchange={() => void loadFeed()} />
            <IconButton icon="gear" variant="bordered" size="lg" href="/feeds/{feed.id}/settings" label="Settings" title="Settings" />
          </div>
        {/if}
      </div>
      <a class="host" href={feed.siteUrl ?? feed.url} target="_blank" rel="noopener">{feedOrigin(feed)} ↗</a>
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
  .crumbs { font-size: calc(13px * var(--size-app)); color: var(--text-3); margin-bottom: 8px; }
  .crumbs a { color: var(--accent); font-weight: 600; }
  .profile { display: flex; gap: 14px; align-items: flex-start; }
  .who { flex: 1; min-width: 0; }
  /* The title takes what room it needs; the buttons sit to its right and drop underneath when the row runs out. */
  .titlerow { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 8px 12px; }
  h1 { flex: 1 1 14ch; min-width: 0; font-family: var(--font-headings); font-size: calc(26px * var(--size-headings)); margin: 0; line-height: 1.15; overflow-wrap: anywhere; }
  .actions { display: flex; gap: 8px; align-items: center; flex: none; }
  .host { display: inline-block; margin-top: 2px; font-size: calc(14px * var(--size-app)); color: var(--accent); font-weight: 600; }
  .desc { margin: 8px 0 0; font-size: calc(14px * var(--size-app)); color: var(--text-2); }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px 8px; margin: 16px 0 0; padding: 12px 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
  .stats div { display: flex; flex-direction: column; gap: 2px; }
  dt { font-size: calc(11px * var(--size-app)); text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-3); }
  dd { margin: 0; font-weight: 600; font-size: calc(15px * var(--size-app)); }
  .banners { display: flex; flex-direction: column; gap: 8px; margin-top: 14px; }
  .river { margin-top: 14px; }
  .status { text-align: center; color: var(--text-3); font-size: calc(14px * var(--size-app)); padding: 18px 0; margin: 0; }
</style>
