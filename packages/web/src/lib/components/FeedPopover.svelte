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
  import IconButton from './IconButton.svelte';
  import Button from './Button.svelte';
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

<dialog bind:this={dialog} onclose={onclose} onclick={(e) => { if (e.target === dialog) dialog?.close(); }} aria-label={feed ? `About ${feed.title ?? hostOf(feed.url)}` : name ? `About ${name}` : 'About this feed'}>
  <div class="sheet">
    {#if feed}
      <header>
        <SourceIcon feedId={feed.id} hasIcon={feed.hasIcon} name={feed.title ?? hostOf(feed.url)} size={48} />
        <div class="who">
          <h2>{feed.title ?? hostOf(feed.url)}</h2>
          <div class="addr">
            <a class="host tap" href={webHref(feed.siteUrl) ?? webHref(feed.url) ?? '#'} target="_blank" rel="noopener">{feedOrigin(feed)} ↗</a>
            {#if feed.requiresSubscription}<Badge title="Posts from this site are behind a paywall: reading them takes a subscription">Requires subscription</Badge>{/if}
          </div>
        </div>
        <IconButton class="close" icon="close" label="Close" onclick={() => dialog?.close()} />
      </header>
      {#if feed.description}<p class="desc">{feed.description}</p>{/if}
      <dl class="stats">
        <div><dt>Last post</dt><dd>{feed.lastItemAt ? relativeTime(feed.lastItemAt) : '—'}</dd></div>
        <div><dt>Last 30 days</dt><dd>{feed.postsLast30d} {feed.postsLast30d === 1 ? 'post' : 'posts'}</dd></div>
        <div><dt>Followers</dt><dd>{feed.followerCount}</dd></div>
      </dl>
      <footer>
        {#if session.user}<FollowControl feedId={feed.id} bind:ids name={feed.title ?? hostOf(feed.url)} />{/if}
        <Button href={feedHref(feed)} onclick={() => dialog?.close()} style="flex: 1">Open feed</Button>
      </footer>
    {:else if missing}
      <header>
        <SourceIcon {feedId} {hasIcon} {name} size={48} />
        <!-- The line under the name says why there's no more, where a feed's address would be. -->
        <div class="who">
          <h2>{name ?? 'This feed'}</h2>
          {#if missing === 'gone'}
            <p class="said">Its feed isn’t on {site.status?.name ?? 'thicket'}</p>
          {:else}
            <p class="said" role="alert">{typeof navigator !== 'undefined' && !navigator.onLine ? 'You’re offline. Reconnect and try again.' : `${site.status?.name ?? 'thicket'} isn’t answering right now. Try again in a minute.`}</p>
          {/if}
        </div>
        <IconButton class="close" icon="close" label="Close" onclick={() => dialog?.close()} />
      </header>
      {#if missing === 'failed'}
        <footer><Button onclick={load} loading={retrying} style="flex: 1">Try again</Button></footer>
      {/if}
    {:else}
      <p class="loading">Loading…</p>
    {/if}
  </div>
</dialog>

<style>
  dialog { border: 0; padding: 0; background: transparent; max-width: 100vw; max-height: 100vh; width: 100vw; height: 100vh; margin: 0; }
  dialog::backdrop { background: var(--scrim); }
  .sheet {
    position: fixed; left: 0; right: 0; bottom: 0; background: var(--surface); color: var(--text);
    border-radius: var(--radius-lg) var(--radius-lg) 0 0; padding: var(--space-4) var(--space-4) calc(var(--space-4) + var(--safe-b)); max-height: 88vh; overflow: auto;
    box-shadow: var(--shadow-sheet);
  }
  @media (min-width: 700px) {
    .sheet { left: 50%; right: auto; bottom: auto; top: 50%; transform: translate(-50%, -50%); width: 420px; border-radius: var(--radius-lg); }
  }
  header { display: flex; align-items: center; gap: var(--space-3); }
  .who { flex: 1; min-width: 0; }
  h2 { margin: 0; font-size: calc(var(--text-xl) * var(--size-headings)); font-family: var(--font-headings); line-height: 1.2; overflow-wrap: anywhere; }
  .host { font-size: calc(var(--text-sm) * var(--size-app)); color: var(--accent); font-weight: 600; }
  /* "Requires subscription" sits beside the address, and drops under it when the line runs out. */
  .addr { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-1) var(--space-2); }
  header :global(.close) { align-self: flex-start; }
  .desc { margin: var(--space-3) 0 0; font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
  .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-2); margin: var(--space-4) 0 0; padding: var(--space-3) 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
  .stats div { display: flex; flex-direction: column; /* 2px is an optical gap between a number and its label. */ gap: 2px; }
  dt { font-size: calc(var(--text-xs) * var(--size-app)); text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-2); }
  dd { margin: 0; font-weight: 600; font-size: calc(var(--text-sm) * var(--size-app)); }
  footer { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-top: var(--space-4); align-items: center; }
  .said { margin: 0; font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); }
  .loading { text-align: center; color: var(--text-2); padding: var(--space-6) 0; }
</style>
