<script lang="ts">
  /**
   * The one row for a feed in a list (Explore, a collection's feeds), so a
   * feed looks the same wherever it's listed. Top to bottom: its name, with a
   * Failing badge when its recent checks failed; the site it's from, tight
   * under the name; what it says about itself; then the facts about how it
   * behaves, run together with dots. The name and site are the feed itself
   * and read dark; the description and facts are about it and read gray.
   * Follow sits at the right, and drops under the text on a phone.
   *
   * Each fact shows only when the screen has it: how often it posts, when it
   * last did (`latest` off where a list is sorted by something else and the
   * date would mislead), its followers, how many people you follow follow it.
   * Anything more a screen wants to say (why a search found it) goes in
   * `children`, under the facts.
   */
  import type { Snippet } from 'svelte';
  import { feedHref } from '$lib/api';
  import { feedOrigin, hostOf, longAgo, postRate } from '$lib/time';
  import { feedListName } from '$lib/feedname';
  import { plural } from '$lib/words';
  import SourceIcon from './SourceIcon.svelte';
  import Badge from './Badge.svelte';
  import Dot from './Dot.svelte';
  import FollowControl from './FollowControl.svelte';

  interface Props {
    feed: {
      id: number; url: string; siteUrl: string | null; title: string | null; displayName?: string | null; slug: string;
      sameTitle?: number; hasIcon: boolean; description?: string | null; lastItemAt: string | null; myCollectionIds: number[];
    };
    failing?: boolean;
    postsLast30d?: number;
    followers?: number;
    /** How many people you follow follow it, when the list is narrowed to them. */
    network?: number;
    latest?: boolean;
    /** Off for someone signed out, who has nothing to file it into. */
    follow?: boolean;
    onopen?: () => void;
    onchange?: (ids: number[]) => void;
    children?: Snippet;
  }

  let { feed: f, failing = false, postsLast30d, followers, network, latest = true, follow = true, onopen, onchange, children }: Props = $props();

  const facts = $derived(
    [
      postsLast30d ? `Publishes about ${postRate(postsLast30d)}` : null,
      latest && f.lastItemAt ? `latest ${longAgo(f.lastItemAt)}` : null,
      followers !== undefined ? plural(followers, 'follower') : null
    ].filter((x): x is string => !!x)
  );
  const name = $derived(f.title ?? hostOf(f.url));
</script>

<li class="feedrow">
  <a class="row tap" href={feedHref(f)} onclick={() => onopen?.()}>
    <SourceIcon feedId={f.id} hasIcon={f.hasIcon} {name} size={40} />
    <div class="meta">
      <span class="named"><span class="title row-name">{feedListName(f)}</span>{#if failing}<Badge tone="danger">Failing</Badge>{/if}</span>
      <span class="row-details origin">{feedOrigin(f)}</span>
      {#if f.description}<span class="row-details desc">{f.description}</span>{/if}
      {#if facts.length || network}
        <span class="row-details facts">
          {#each facts as fact, i (i)}{#if i > 0}{' '}<Dot />{' '}{/if}{i === 0 ? fact[0].toUpperCase() + fact.slice(1) : fact}{/each}{#if network}{#if facts.length}{' '}<Dot />{' '}{/if}<span class="net">{plural(network, 'person', 'people')} you follow</span>{/if}
        </span>
      {/if}
      {@render children?.()}
    </div>
  </a>
  {#if follow}
    <FollowControl feedId={f.id} ids={f.myCollectionIds} {name} small {onchange} />
  {/if}
</li>

<style>
  .feedrow { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
  .row { flex: 1; min-width: 0; display: flex; align-items: center; gap: var(--space-3); }
  .meta { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .named { display: flex; align-items: center; gap: var(--space-2); min-width: 0; }
  .title { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  /* The site is part of who the feed is, so it reads dark with the name, tight
     under it like a byline. The -2px is optical: it takes back some of the
     empty space above and below each line of text, so the two read as a pair. */
  .origin { margin-top: -2px; color: var(--text); overflow-wrap: anywhere; }
  .desc { margin-top: var(--space-1); display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .facts { margin-top: var(--space-1); }
  .net { color: var(--accent); font-weight: 600; }
  /* Last, so it wins over the row's own sizing above. On a phone the button would squeeze the description into a column four
     words wide, so it drops to its own line, at the right, and the text gets
     the row. */
  @media (max-width: 560px) {
    .row { flex-basis: 100%; }
    .feedrow > :global(.follow) { margin-left: auto; }
  }
  @media (hover: hover) { .row:hover .title { text-decoration: underline; text-underline-offset: 3px; } }
</style>
