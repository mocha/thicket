<script lang="ts">
  import Card from './Card.svelte';
  import Dot from '$lib/components/Dot.svelte';
  /**
   * What a person has been up to: feeds they added, collections they made or
   * copied, posts they saved, notes they wrote — one list, newest first.
   *
   * Derived from the rows themselves rather than a log, so anything they undo
   * or hide simply stops appearing. A burst of feed adds to one collection (an
   * import, a copy) arrives already collapsed, so one act reads as one line.
   */
  import { api, profilesApi, publicCollectionHref, type ActivityEntry } from '$lib/api';
  import SourceIcon from './SourceIcon.svelte';
  import FeedPopover from './FeedPopover.svelte';
  import { relativeTime, hostOf, savedHref, ugcRel } from '$lib/time';
  import { audienceTag } from '$lib/visibility';
  import { session } from '$lib/session.svelte';
  import VisitorMore from './VisitorMore.svelte';
  import EmptyNote from './EmptyNote.svelte';
  import Badge from './Badge.svelte';

  /** `limit`: a preview of the newest few, on a profile's Overview, with no Show more. */
  /** `empty`: set once the list has loaded with nothing in it, so a caller can drop its link to the full list. */
  let { handle, isMe, limit, empty = $bindable(false) }: { handle: string; isMe: boolean; limit?: number; empty?: boolean } = $props();
  $effect(() => { empty = entries !== null && entries.length === 0; });

  /** A bookmarked or noted post's feed, its card open from the line's icon or site name. */
  type Source = { feedId: number | null; hasIcon: boolean; name: string };
  let source = $state<Source | null>(null);
  function openSource(s: Source) {
    api.event('source_opened', { feedId: s.feedId, via: 'activity' });
    source = s;
  }

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
  const visible = $derived((entries ?? []).slice(0, limit ?? shown));

  async function load(before: string | null) {
    busy = true;
    try {
      const r = await profilesApi.activity(handle, before, limit ?? (session.user ? PAGE : 100));
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

<!-- A post's site, on a bookmark or note line: the icon (for the pointer) and the name (the keyboard stop) open the feed's card. -->
{#snippet icon(p: { url: string; title: string | null; siteTitle: string | null; feedId: number | null; hasIcon: boolean })}
  <button class="srcicon" tabindex="-1" onclick={() => openSource({ feedId: p.feedId, hasIcon: p.hasIcon, name: p.siteTitle ?? hostOf(p.url) })} aria-label="About {p.siteTitle ?? hostOf(p.url)}" title="About {p.siteTitle ?? hostOf(p.url)}">
    <SourceIcon feedId={p.feedId} hasIcon={p.hasIcon} name={p.siteTitle ?? p.title} size={20} />
  </button>
{/snippet}
{#snippet site(p: { url: string; siteTitle: string | null; feedId: number | null; hasIcon: boolean })}
  <span class="src"><button onclick={() => openSource({ feedId: p.feedId, hasIcon: p.hasIcon, name: p.siteTitle ?? hostOf(p.url) })} title="About {p.siteTitle ?? hostOf(p.url)}">{p.siteTitle ?? hostOf(p.url)}</button></span>
{/snippet}

{#if entries !== null && entries.length === 0 && !failed}
  <EmptyNote icon="activity" title="No activity yet" text={isMe ? 'Follow a feed, bookmark a post, or write a note, and it shows up here.' : 'Nothing to show yet.'} />
{:else}
<Card kind="list" as="div">
    {#if failed}
      <div class="pad"><p class="status">{failed}</p></div>
    {:else if entries === null}
      <div class="pad"><p class="status">Loading…</p></div>
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
                <a href={publicCollectionHref(handle, e.payload.collection.slug)}>{e.payload.collection.name}</a>{#if isMe && audienceTag(e.payload.collection.visibility)}<Badge class="aftertext">{audienceTag(e.payload.collection.visibility)}</Badge>{/if}
              </p>
              <span class="when">{relativeTime(e.at)}</span>
            </div>
            <p class="names">
              <span class="trunc">{#each e.payload.feeds as f, i (i)}{#if i > 0}{' '}<Dot />{' '}{/if}{f.title}{/each}</span>
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
                {/if}{#if isMe && audienceTag(e.payload.visibility)}<Badge class="aftertext">{audienceTag(e.payload.visibility)}</Badge>{/if}
              </p>
              <span class="when">{relativeTime(e.at)}</span>
            </div>
          {:else if e.kind === 'bookmark'}
            <div class="row">
              {@render icon(e.payload)}
              <p class="what">
                Bookmarked <a href={savedHref(e.payload.url) ?? '#'} target="_blank" rel={ugcRel(savedHref(e.payload.url))}>{e.payload.title ?? e.payload.url}</a>
                {@render site(e.payload)}
              </p>
              <span class="when">{relativeTime(e.at)}</span>
            </div>
          {:else}
            <div class="row">
              {@render icon(e.payload)}
              <p class="what">
                Noted on <a href={savedHref(e.payload.url) ?? '#'} target="_blank" rel={ugcRel(savedHref(e.payload.url))}>{e.payload.title ?? e.payload.url}</a>
                {@render site(e.payload)}
              </p>
              <span class="when">{relativeTime(e.at)}</span>
            </div>
            <blockquote>{e.payload.body}</blockquote>
          {/if}
        </li>
      {/each}
    </ul>
      <!-- A preview (limit) has no Show more: the caller links to the full list. -->
      {#if limit === undefined && (cursor || shown < entries.length)}
        <div class="foot"><button class="more tap" onclick={more} disabled={busy}>{busy ? 'Loading…' : 'Show more'}</button></div>
      {:else if cappedAt}
        <div class="foot"><VisitorMore cap={cappedAt} /></div>
      {/if}
    {/if}
</Card>
{/if}

{#if source}
  <FeedPopover feedId={source.feedId} hasIcon={source.hasIcon} name={source.name} onclose={() => (source = null)} />
{/if}

<style>
  .pad { padding: var(--card-pad); }
  .foot { padding: var(--space-3) var(--space-4); border-top: 1px solid var(--line); }
  .status { color: var(--text-2); font-size: calc(var(--text-sm) * var(--size-app)); margin: 0; }
  .acts { list-style: none; margin: 0; padding: 0; }
  li { padding: var(--space-3) var(--space-4); border-top: 1px solid var(--line); }
  li:first-child { border-top: 0; }
  .row { display: flex; align-items: center; gap: var(--space-3); }
  .icons { display: flex; flex: none; }
  /* Overlapped, so a burst of feeds reads as one object rather than a row of them.
     The pull is set against the icon's own width, so it stays a literal. */
  .icons > :global(*:not(:first-child)) { margin-left: -7px; }
  .glyph { flex: none; width: 20px; text-align: center; color: var(--text-3); font-size: calc(var(--text-base) * var(--size-app)); }
  .what { flex: 1; min-width: 0; margin: 0; font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .what a { color: var(--text); font-weight: 600; }
  .src { color: var(--text-2); font-size: calc(var(--text-sm) * var(--size-app)); }
  /* The same heavier dot as everywhere else (Dot.svelte), drawn here so it can come and go with the source. */
  .src::before { content: '·'; display: inline-block; margin: 0 0.3em; font-weight: 900; font-size: 1.35em; line-height: 0; vertical-align: -0.06em; color: var(--text-3); }
  .srcicon { flex: none; display: inline-flex; }
  @media (hover: hover) { .src button:hover { text-decoration: underline; text-underline-offset: 3px; } }
  .when { flex: none; font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); }
  /* Indented to line up under the row's text: the glyph column plus the row's gap. */
  .names { display: flex; gap: var(--space-1); margin: var(--space-1) 0 0 var(--space-6); font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); }
  .trunc { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rest { flex: none; }
  .rest::before { content: '·'; display: inline-block; margin-right: 0.3em; font-weight: 900; font-size: 1.35em; line-height: 0; vertical-align: -0.06em; color: var(--text-3); }
  blockquote { margin: var(--space-2) 0 0 var(--space-6); padding-left: var(--space-3); border-left: 2px solid var(--line); font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); white-space: pre-line; display: -webkit-box; -webkit-line-clamp: 4; line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
  /* A pill riding after a link, mid-sentence, needs its own gap. */
  .what :global(.aftertext) { margin-left: var(--space-2); }
  .more { display: block; width: 100%; text-align: center; color: var(--accent); font-weight: 600; font-size: calc(var(--text-sm) * var(--size-app)); }
  .more:disabled { opacity: 0.6; }
</style>
