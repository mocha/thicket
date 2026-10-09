<script lang="ts">
  /**
   * Small profile card for a feed, opened from a post's source line. Everything
   * feed-level lives here so the post card can stay about the post: identity,
   * a little metadata, my relationship to it, and the way out to the feed page
   * or the site itself.
   *
   * A post can outlive its feed: a bookmark keeps its own copy after the feed
   * is removed, and one saved by address never had a feed here. Then `feedId`
   * is null, or the feed comes back not found, and the card says so under
   * the post's own `name` for the site. Any other failure offers a retry
   * rather than sitting on "Loading…".
   */
  import { api, ApiError, feedHref, type Feed } from '$lib/api';
  import { feedOrigin, hostOf, relativeTime, webHref } from '$lib/time';
  import SourceIcon from './SourceIcon.svelte';
  import FollowControl from './FollowControl.svelte';
  import Sheet from './Sheet.svelte';
  import Badge from './Badge.svelte';
  import { session } from '$lib/session.svelte';
  import { site } from '$lib/site.svelte';
  import { untrack } from 'svelte';

  let { feedId, name = null, hasIcon = false, onclose }: { feedId: number | null; name?: string | null; hasIcon?: boolean; onclose: () => void } = $props();
  let feed = $state<Feed | null>(null);
  let ids = $state<number[]>([]);
  /** `gone`: there's no feed for this post here. `failed`: we couldn't ask. */
  let missing = $state<'gone' | 'failed' | null>(null);
  /** Asking again after a failure: the message and button stay put meanwhile. */
  let retrying = $state(false);
  let dialog = $state<HTMLDialogElement | null>(null);
  /** The feed's name: its own once loaded, the post's until then. */
  const shown = $derived(feed ? feed.title ?? hostOf(feed.url) : name ?? 'This feed');

  function load() {
    if (feedId === null) { missing = 'gone'; return; }
    retrying = missing === 'failed';
    api.feed(feedId).then(
      (f) => { feed = f; ids = f.myCollectionIds; },
      (e) => {
        if (e instanceof ApiError && e.status === 404) { missing = 'gone'; return; }
        console.error(`Couldn't load feed ${feedId} for its card:`, e);
        missing = 'failed';
      },
    ).finally(() => (retrying = false));
  }

  $effect(() => {
    dialog?.showModal();
    untrack(load);
  });
</script>

<!-- The header is the feed itself: its icon and name, then its address (or why
     there's nothing more), and your Follow. While it loads, the name the post
     already knows stands in, so the panel doesn't jump when the feed arrives. -->
{#snippet header()}
  <div class="id">
    <SourceIcon feedId={feed?.id ?? feedId} hasIcon={feed?.hasIcon ?? hasIcon} name={shown} size={48} />
    <div class="who">
      <h2>{shown}</h2>
      {#if feed}
        <div class="addr">
          <a class="host tap" href={webHref(feed.siteUrl) ?? webHref(feed.url) ?? '#'} target="_blank" rel="noopener">{feedOrigin(feed)} ↗</a>
          {#if feed.requiresSubscription}<Badge title="Posts from this site are behind a paywall: reading them takes a subscription">Requires subscription</Badge>{/if}
        </div>
        {#if session.user}<div class="follow"><FollowControl feedId={feed.id} bind:ids name={shown} /></div>{/if}
      {:else if missing === 'gone'}
        <p class="said">Not on {site.status?.name ?? 'thicket'}</p>
      {:else if missing === 'failed'}
        <p class="said" role="alert">{typeof navigator !== 'undefined' && !navigator.onLine ? 'You’re offline. Reconnect and try again.' : `${site.status?.name ?? 'thicket'} isn’t answering right now. Try again in a minute.`}</p>
      {/if}
    </div>
  </div>
{/snippet}

<Sheet title={feed || name ? `About ${shown}` : 'About this feed'} {header} bind:dialog {onclose}>
  {#if feed}
    {#if feed.description}<p class="desc">{feed.description}</p>{/if}
    <dl class="stats">
      <div><dt>Last post</dt><dd>{feed.lastItemAt ? relativeTime(feed.lastItemAt) : '—'}</dd></div>
      <div><dt>Last 30 days</dt><dd>{feed.postsLast30d} {feed.postsLast30d === 1 ? 'post' : 'posts'}</dd></div>
      <div><dt>Followers</dt><dd>{feed.followerCount}</dd></div>
    </dl>
  {:else if missing === 'gone'}
    <p class="desc">To get new posts from this site, use Add new feed.</p>
  {:else if !missing}
    <p class="loading">Loading…</p>
  {/if}
  {#snippet footer()}
    {#if feed}<a class="sheet-action" href={feedHref(feed)} onclick={() => dialog?.close()}>Open feed</a>
    {:else if missing === 'failed'}<button type="button" class="sheet-action" onclick={load} disabled={retrying}>{retrying ? 'Trying again…' : 'Try again'}</button>{/if}
  {/snippet}
</Sheet>

<style>
  .id { display: flex; align-items: center; gap: var(--space-3); }
  .who { flex: 1; min-width: 0; }
  h2 { margin: 0; font-size: calc(var(--text-xl) * var(--size-headings)); font-family: var(--font-headings); line-height: 1.2; overflow-wrap: anywhere; }
  .host { font-size: calc(var(--text-sm) * var(--size-app)); color: var(--accent); font-weight: 600; }
  /* "Requires subscription" sits beside the address, and drops under it when the line runs out. */
  .addr { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-1) var(--space-2); }
  .follow { margin-top: var(--space-2); }
  .desc { margin: 0; font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
  .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-2); margin: 0; padding: var(--space-3) 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
  .stats div { display: flex; flex-direction: column; /* 2px is an optical gap between a number and its label. */ gap: 2px; }
  dt { font-size: calc(var(--text-xs) * var(--size-app)); text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-2); }
  dd { margin: 0; font-weight: 600; font-size: calc(var(--text-sm) * var(--size-app)); }
  .said { margin: 0; font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); }
  .loading { margin: 0; text-align: center; color: var(--text-2); padding: var(--space-4) 0; }
</style>
