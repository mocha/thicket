<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { replaceState } from '$app/navigation';
  import { api, feedHref, type Feed } from '$lib/api';
  import { feedName } from '$lib/feedname';
  import { feedOrigin, hostOf, relativeTime } from '$lib/time';
  import SourceIcon from '$lib/components/SourceIcon.svelte';
  import River from '$lib/components/River.svelte';
  import FollowButton from '$lib/components/FollowButton.svelte';
  import { showToast } from '$lib/toast.svelte';

  /**
   * A feed on its own terms: who they are, how active, whether I follow them,
   * and everything they've posted as a single-feed river. Exists independent
   * of any user, which is what makes it the unit of discovery.
   * URL is /feeds/:id/:slug; the id is canonical, the slug is corrected in place.
   */
  const id = $derived(Number(page.params.id));
  let feed = $state<Feed | null>(null);
  let ids = $state<number[]>([]);
  let river = $state<River | null>(null);
  let refreshing = $state(false);
  let cooldown = $state<number | null>(null);
  let loadedId = $state<number | undefined>(undefined);

  async function loadFeed() {
    feed = await api.feed(id);
    ids = feed.myCollectionIds;
    if (page.params.slug !== feed.slug) replaceState(feedHref(feed) + page.url.search, {});
  }

  async function refresh() {
    refreshing = true;
    try {
      const r = await api.refresh(id);
      if (!r.ok) {
        cooldown = r.cooldown;
        showToast(`Fetched recently. Try again in ${Math.ceil(r.cooldown / 60)} min.`);
        return;
      }
      await Promise.all([loadFeed(), river?.reload()]);
      showToast('Refreshed');
      api.event('feed_refreshed', { feedId: id });
    } finally {
      refreshing = false;
    }
  }

  onMount(() => api.event('feed_view', { feedId: id }));

  $effect(() => {
    if (loadedId === id) return;
    loadedId = id;
    feed = null; cooldown = null;
    void loadFeed();
  });

</script>

<nav class="crumbs"><a href="/feeds">Feeds</a> <span aria-hidden="true">›</span></nav>

{#if feed}
  <header class="profile">
    <SourceIcon feedId={feed.id} hasIcon={feed.hasIcon} name={feedName(feed)} size={64} />
    <div class="who">
      <h1>{feedName(feed)}</h1>
      <a class="host" href={feed.siteUrl ?? feed.url} target="_blank" rel="noopener">{feedOrigin(feed)} ↗</a>
      {#if feed.description}<p class="desc">{feed.description}</p>{/if}
    </div>
  </header>

  <dl class="stats">
    <div><dt>Last post</dt><dd>{feed.lastItemAt ? relativeTime(feed.lastItemAt) : '—'}</dd></div>
    <div><dt>Last 30 days</dt><dd>{feed.postsLast30d}</dd></div>
    <div><dt>All time</dt><dd>{feed.itemCount}</dd></div>
    <div><dt>Followers</dt><dd>{feed.followerCount}</dd></div>
  </dl>

  <div class="actions">
    <FollowButton feedId={feed.id} bind:ids name={feed.title ?? hostOf(feed.url)} onchange={() => void loadFeed()} />
    <button class="btn" onclick={refresh} disabled={refreshing} title={feed.lastFetchedAt ? `Last fetched ${relativeTime(feed.lastFetchedAt)}` : ''}>{refreshing ? 'Refreshing…' : 'Refresh'}</button>
    <a class="btn" href="/feeds/{feed.id}/settings">Settings</a>
    {#if feed.hideShorts}<a class="note" href="/feeds/{feed.id}/settings">Shorts hidden</a>{/if}
    {#if feed.consecutiveFailures > 0}<span class="bad">Last fetch failed: {feed.lastError ?? feed.lastStatus}</span>{/if}
  </div>
{:else}
  <p class="status">Loading…</p>
{/if}

<River bind:this={river} feed={id} showSource={false} emptyTitle="No posts yet" emptyBody={feed && !feed.lastFetchedAt ? 'This feed hasn’t been fetched yet.' : 'Nothing has come through from this feed so far.'} emptyAction={null} />

<style>
  .crumbs { font-size: 13px; color: var(--text-3); margin-bottom: 8px; }
  .crumbs a { color: var(--accent); font-weight: 600; }
  .profile { display: flex; gap: 14px; align-items: flex-start; }
  .who { flex: 1; min-width: 0; }
  h1 { font-family: var(--font-serif); font-size: 26px; margin: 0; line-height: 1.15; overflow-wrap: anywhere; }
  .host { font-size: 14px; color: var(--accent); font-weight: 600; }
  .desc { margin: 8px 0 0; font-size: 14px; color: var(--text-2); }
  .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 16px 0 0; padding: 12px 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
  .stats div { display: flex; flex-direction: column; gap: 2px; }
  dt { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-3); }
  dd { margin: 0; font-weight: 600; font-size: 15px; }
  .actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin: 14px 0 18px; }
  .btn { padding: 9px 14px; border-radius: 999px; border: 1px solid var(--line); background: var(--surface); font-size: 14px; font-weight: 600; color: var(--text-2); }
  .btn:disabled { opacity: 0.6; }
  .bad { font-size: 13px; color: var(--danger); }
  .note { font-size: 13px; color: var(--text-3); }
  .status { text-align: center; color: var(--text-3); font-size: 14px; padding: 18px 0; margin: 0; }
</style>
