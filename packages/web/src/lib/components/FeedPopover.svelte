<script lang="ts">
  /**
   * Small profile card for a feed, opened from a post's source line. Everything
   * feed-level lives here so the post card can stay about the post: identity,
   * a little metadata, my relationship to it, and the way out to the feed page
   * or the site itself.
   */
  import { api, feedHref, type Feed } from '$lib/api';
  import { feedOrigin, hostOf, relativeTime } from '$lib/time';
  import SourceIcon from './SourceIcon.svelte';
  import FollowControl from './FollowControl.svelte';
  import IconButton from './IconButton.svelte';
  import Button from './Button.svelte';
  import { session } from '$lib/session.svelte';

  let { feedId, onclose }: { feedId: number; onclose: () => void } = $props();
  let feed = $state<Feed | null>(null);
  let ids = $state<number[]>([]);
  let dialog = $state<HTMLDialogElement | null>(null);

  $effect(() => {
    dialog?.showModal();
    api.feed(feedId).then((f) => { feed = f; ids = f.myCollectionIds; });
  });
</script>

<dialog bind:this={dialog} onclose={onclose} onclick={(e) => { if (e.target === dialog) dialog?.close(); }}>
  <div class="sheet">
    {#if feed}
      <header>
        <SourceIcon feedId={feed.id} hasIcon={feed.hasIcon} name={feed.title ?? hostOf(feed.url)} size={48} />
        <div class="who">
          <h2>{feed.title ?? hostOf(feed.url)}</h2>
          <a class="host" href={feed.siteUrl ?? feed.url} target="_blank" rel="noopener">{feedOrigin(feed)} ↗</a>
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
        {#if session.user}<FollowControl feedId={feed.id} bind:ids name={feed.title ?? hostOf(feed.url)} inline />{/if}
        <Button href={feedHref(feed)} onclick={() => dialog?.close()} style="flex: 1">Open feed</Button>
      </footer>
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
    border-radius: var(--radius-lg) var(--radius-lg) 0 0; padding: 18px 16px calc(16px + var(--safe-b)); max-height: 88vh; overflow: auto;
    box-shadow: var(--shadow-sheet);
  }
  @media (min-width: 700px) {
    .sheet { left: 50%; right: auto; bottom: auto; top: 50%; transform: translate(-50%, -50%); width: 420px; border-radius: var(--radius-lg); }
  }
  header { display: flex; align-items: center; gap: 12px; }
  .who { flex: 1; min-width: 0; }
  h2 { margin: 0; font-size: calc(var(--text-xl) * var(--size-headings)); font-family: var(--font-headings); line-height: 1.2; overflow-wrap: anywhere; }
  .host { font-size: calc(var(--text-sm) * var(--size-app)); color: var(--accent); font-weight: 600; }
  header :global(.close) { align-self: flex-start; }
  .desc { margin: 12px 0 0; font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
  .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 14px 0 0; padding: 12px 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
  .stats div { display: flex; flex-direction: column; gap: 2px; }
  dt { font-size: calc(var(--text-xs) * var(--size-app)); text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-3); }
  dd { margin: 0; font-weight: 600; font-size: calc(var(--text-sm) * var(--size-app)); }
  footer { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; align-items: center; }
  .loading { text-align: center; color: var(--text-3); padding: 30px 0; }
</style>
