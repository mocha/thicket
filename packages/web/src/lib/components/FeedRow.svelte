<script lang="ts">
  /**
   * The one row for a feed in a list (Explore, a collection's feeds), so a
   * feed looks the same wherever it's listed. Top to bottom: its name, with a
   * Failing badge when its recent checks failed; the site it's from, tight
   * under the name; what it says about itself; then the facts about how it
   * behaves, run together with dots. The name and site are the feed itself
   * and read dark; the description and facts are about it and read gray.
   * Follow sits at the right; on a phone, where it would squeeze the
   * description, it shares the facts line (the shared row-ended layout in
   * app.css). The icon, name and site are the
   * shared FeedLine, which the Import review uses too.
   *
   * Each fact shows only when the screen has it: how often it posts, when it
   * last did (`latest` off where a list is sorted by something else and the
   * date would mislead), its followers, how many people you follow follow it.
   * Anything more a screen wants to say (why a search found it) goes in
   * `children`, on a line of its own under the facts, so neither line runs
   * long.
   */
  import type { Snippet } from 'svelte';
  import { feedHref } from '$lib/api';
  import { feedOrigin, hostOf, longAgo, postRate } from '$lib/time';
  import { feedListName } from '$lib/feedname';
  import { plural } from '$lib/words';
  import FeedLine from './FeedLine.svelte';
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

<li class="feedrow row-ended wide beside">
  <a class="row row-main" href={feedHref(f)} onclick={() => onopen?.()}>
    <FeedLine feedId={f.id} hasIcon={f.hasIcon} {name} label={feedListName(f)} origin={feedOrigin(f)}>
      {#snippet badge()}{#if failing}<Badge tone="danger">Failing</Badge>{/if}{/snippet}
      {#if f.description}<span class="row-details desc">{f.description}</span>{/if}
    </FeedLine>
  </a>
  {#if facts.length || network || children || follow}
    <div class="row-foot">
      {#if facts.length || network || children}
        <span class="facts row-facts">
          {#if facts.length || network}
            <span class="row-details">{#each facts as fact, i (i)}{#if i > 0}{' '}<Dot />{' '}{/if}<span class="fact">{i === 0 ? fact[0].toUpperCase() + fact.slice(1) : fact}</span>{/each}{#if network}{#if facts.length}{' '}<Dot />{' '}{/if}<span class="net">{plural(network, 'person', 'people')} you follow</span>{/if}</span>
          {/if}
          {#if children}<span class="row-details">{@render children()}</span>{/if}
        </span>
      {/if}
      {#if follow}
        <FollowControl feedId={f.id} ids={f.myCollectionIds} {name} small {onchange} class="row-end" />
      {/if}
    </div>
  {/if}
</li>

<style>
  /* Close under the name, so the two read as a pair, as on the Person and Collection rows. */
  .desc { margin-top: -2px; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
  /* The facts, then the search's own line under them. */
  .facts { display: flex; flex-direction: column; }
  /* A long line breaks at a dot, never inside a fact ("latest 5 / hours ago"). */
  .fact { white-space: nowrap; }
  .net { color: var(--accent); font-weight: 600; }
  /* On a phone the facts wrap beside Follow (`beside`), so a fact may break inside itself. */
  @media (max-width: 560px) { .fact { white-space: normal; } }
  @media (hover: hover) { .row:hover :global(.title) { text-decoration: underline; text-underline-offset: 3px; } }
</style>
