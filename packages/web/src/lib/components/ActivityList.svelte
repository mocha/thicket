<script lang="ts">
  /**
   * What a person has been up to: feeds they added, collections they made or
   * copied, posts they saved, notes they wrote — one list, newest first.
   *
   * Derived from the rows themselves rather than a log, so anything they undo
   * or hide simply stops appearing. A burst of feed adds to one collection (an
   * import, a copy) arrives already collapsed, so one act reads as one line.
   */
  import { profilesApi, publicCollectionHref, type ActivityEntry } from '$lib/api';
  import { api } from '$lib/api';
  import SourceIcon from './SourceIcon.svelte';
  import { relativeTime, hostOf } from '$lib/time';
  import { session } from '$lib/session.svelte';
  import VisitorMore from './VisitorMore.svelte';

  let { handle, isMe }: { handle: string; isMe: boolean } = $props();

  /**
   * Shown PAGE at a time. Signed in, each Show more asks the server for the
   * next page. Signed out, a limited instance sends everything a visitor may
   * see in one response and nothing after, so Show more reveals what is
   * already here, and the end of it says there is more for an account.
   */
  const PAGE = 20;
  let entries = $state<ActivityEntry[] | null>(null);
  let cursor = $state<string | null>(null);
  let cappedAt = $state<number | null>(null);
  let shown = $state(PAGE);
  let busy = $state(false);
  let failed = $state<string | null>(null);
  let loadedFor = $state<string | undefined>(undefined);
  const visible = $derived((entries ?? []).slice(0, shown));

  async function load(before: string | null) {
    busy = true;
    try {
      const r = await profilesApi.activity(handle, before, session.user ? PAGE : 100);
      entries = [...(before ? (entries ?? []) : []), ...r.entries];
      cursor = r.nextCursor;
      cappedAt = r.cappedAt ?? null;
    } catch (e) {
      failed = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  $effect(() => {
    if (loadedFor === handle) return;
    loadedFor = handle;
    entries = null; cursor = null; failed = null; cappedAt = null; shown = PAGE;
    void load(null);
  });

  async function more() {
    api.event('activity_more', { handle });
    if (shown < (entries?.length ?? 0)) { shown += PAGE; return; }
    await load(cursor);
    shown += PAGE;
  }

  const key = (e: ActivityEntry) => `${e.kind}:${e.id}:${e.at}`;
  const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;
</script>

<section>
  <h2>Recent activity</h2>

  {#if failed}
    <p class="status">{failed}</p>
  {:else if entries === null}
    <p class="status">Loading…</p>
  {:else if entries.length === 0}
    <p class="status">{isMe ? 'Follow a feed, save a post or write a note and it shows up here.' : 'Nothing to show yet.'}</p>
  {:else}
    <ul class="acts">
      {#each visible as e (key(e))}
        <li>
          {#if e.kind === 'feeds'}
            <div class="row">
              <div class="icons" aria-hidden="true">
                {#each e.payload.feeds.slice(0, 4) as f (f.id)}
                  <SourceIcon feedId={f.id} hasIcon={f.hasIcon} name={f.title} size={20} />
                {/each}
              </div>
              <p class="what">
                Added {plural(e.payload.count, 'feed')} to
                <a href={publicCollectionHref(handle, e.payload.collection.slug)}>{e.payload.collection.name}</a>
                {#if isMe && !e.payload.collection.isPublic}<span class="tag">Private</span>{/if}
              </p>
              <span class="when">{relativeTime(e.at)}</span>
            </div>
            <p class="names">
              <span class="trunc">{e.payload.feeds.map((f) => f.title).join(' · ')}</span>
              {#if e.payload.count > e.payload.feeds.length}<span class="rest">and {e.payload.count - e.payload.feeds.length} more</span>{/if}
            </p>
          {:else if e.kind === 'collection'}
            <div class="row">
              <span class="glyph" aria-hidden="true">{e.payload.copiedFrom ? '⧉' : '✦'}</span>
              <p class="what">
                {#if e.payload.copiedFrom}
                  Copied <a href={publicCollectionHref(handle, e.payload.slug)}>{e.payload.name}</a>
                  from <a href="/@{e.payload.copiedFrom.handle}">@{e.payload.copiedFrom.handle}</a>
                {:else}
                  Made a collection, <a href={publicCollectionHref(handle, e.payload.slug)}>{e.payload.name}</a>
                {/if}
                {#if isMe && !e.payload.isPublic}<span class="tag">Private</span>{/if}
              </p>
              <span class="when">{relativeTime(e.at)}</span>
            </div>
          {:else if e.kind === 'bookmark'}
            <div class="row">
              <SourceIcon feedId={e.payload.feedId} hasIcon={e.payload.hasIcon} name={e.payload.siteTitle ?? e.payload.title} size={20} />
              <p class="what">
                Saved <a href={e.payload.url} target="_blank" rel="noopener">{e.payload.title ?? e.payload.url}</a>
                <span class="src">{e.payload.siteTitle ?? hostOf(e.payload.url)}</span>
              </p>
              <span class="when">{relativeTime(e.at)}</span>
            </div>
          {:else}
            <div class="row">
              <SourceIcon feedId={e.payload.feedId} hasIcon={e.payload.hasIcon} name={e.payload.siteTitle ?? e.payload.title} size={20} />
              <p class="what">
                Noted on <a href={e.payload.url} target="_blank" rel="noopener">{e.payload.title ?? e.payload.url}</a>
                <span class="src">{e.payload.siteTitle ?? hostOf(e.payload.url)}</span>
              </p>
              <span class="when">{relativeTime(e.at)}</span>
            </div>
            <blockquote>{e.payload.body}</blockquote>
          {/if}
        </li>
      {/each}
    </ul>
    {#if cursor || shown < entries.length}
      <button class="more" onclick={more} disabled={busy}>{busy ? 'Loading…' : 'Show more'}</button>
    {:else if cappedAt}
      <VisitorMore cap={cappedAt} />
    {/if}
  {/if}
</section>

<style>
  section { margin-bottom: 22px; }
  h2 { font-size: calc(16px * var(--size-app)); margin: 0 0 8px; }
  .status { color: var(--text-3); font-size: calc(14px * var(--size-app)); padding: 8px 0; margin: 0; }
  .acts { list-style: none; margin: 0; padding: 0; background: var(--surface); border-radius: var(--radius); box-shadow: var(--shadow); overflow: hidden; }
  li { padding: 12px 16px; border-top: 1px solid var(--line); }
  li:first-child { border-top: 0; }
  .row { display: flex; align-items: center; gap: 10px; }
  .icons { display: flex; flex: none; }
  /* Overlapped, so a burst of feeds reads as one object rather than a row of them. */
  .icons > :global(*:not(:first-child)) { margin-left: -7px; }
  .glyph { flex: none; width: 20px; text-align: center; color: var(--text-3); font-size: calc(15px * var(--size-app)); }
  .what { flex: 1; min-width: 0; margin: 0; font-size: calc(14px * var(--size-app)); color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .what a { color: var(--text); font-weight: 600; }
  .src { color: var(--text-3); font-size: calc(13px * var(--size-app)); }
  .src::before { content: ' · '; }
  .when { flex: none; font-size: calc(12px * var(--size-app)); color: var(--text-3); }
  .names { display: flex; gap: 5px; margin: 4px 0 0 30px; font-size: calc(13px * var(--size-app)); color: var(--text-3); }
  .trunc { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rest { flex: none; }
  .rest::before { content: '· '; }
  blockquote { margin: 6px 0 0 30px; padding-left: 10px; border-left: 2px solid var(--line); font-size: calc(14px * var(--size-app)); color: var(--text-2); white-space: pre-line; display: -webkit-box; -webkit-line-clamp: 4; line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
  .tag { font-size: calc(11px * var(--size-app)); font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-3); border: 1px solid var(--line); border-radius: 999px; padding: 1px 7px; margin-left: 4px; }
  .more { display: block; width: 100%; margin-top: 10px; padding: 10px; border-radius: 12px; border: 1px solid var(--line); background: var(--surface); color: var(--text-2); font-size: calc(14px * var(--size-app)); font-weight: 600; }
  .more:disabled { opacity: 0.6; }
</style>
