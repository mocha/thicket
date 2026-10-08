<script lang="ts">
  import PageHeader from '$lib/components/PageHeader.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import Button from '$lib/components/Button.svelte';
  import Dot from '$lib/components/Dot.svelte';
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
  import { cameFrom as wayBack, keepCameFrom } from '$lib/wayback';
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
  /** The feed's picture is exactly as tall as its name and address beside it, up to 72px for a name that wraps onto more lines. */
  let whoHeight = $state(0);

  /** "1,254 posts in 30 days · 12% were reposts · 3 following · last post 13 minutes ago". Reposts only when there are some. */
  function statsLine(f: NonNullable<typeof feed>): string[] {
    const n = (v: number) => v.toLocaleString();
    const parts = [`${n(f.postsLast30d)} ${f.postsLast30d === 1 ? 'post' : 'posts'} in 30 days`];
    if (f.repeatsLast30d > 0 && f.postsLast30d > 0) parts.push(`${Math.round((100 * f.repeatsLast30d) / f.postsLast30d)}% were reposts`);
    parts.push(`${n(f.followerCount)} following`);
    parts.push(f.lastItemAt ? `last post ${longAgo(f.lastItemAt)}` : 'no posts yet');
    return parts;
  }

  $effect(() => {
    if (loadedId === id) return;
    loadedId = id;
    feed = null;
    void loadFeed();
  });
</script>

<svelte:head><title>{feed ? feedName(feed) : 'Feed'} · thicket</title></svelte:head>

{#if feed}
  <PageHeader above={session.user ? back : undefined} description={stats}>
    {#snippet title()}
      <div class="profile">
        <SourceIcon feedId={feed!.id} hasIcon={feed!.hasIcon} name={feedName(feed!)} size={Math.min(whoHeight || 48, 72)} />
        <div class="who" bind:offsetHeight={whoHeight}>
          <h1>{feedName(feed!)}</h1>
          <div class="addr">
            <a class="host tap" href={webHref(feed!.siteUrl) ?? webHref(feed!.url) ?? '#'} target="_blank" rel="noopener"><span class="hosttext">{feedOrigin(feed!)} ↗</span></a>
            {#if feed!.requiresSubscription}<Badge title="Posts from this site are behind a paywall: reading them takes a subscription">Requires subscription</Badge>{/if}
          </div>
        </div>
      </div>
    {/snippet}
    {#snippet actions()}
      {#if session.user}
        <FollowControl feedId={feed!.id} bind:ids name={feedName(feed!)} followLabel="Follow this feed" small onchange={() => void loadFeed()} />
        <Button size="sm" href="/feeds/{feed!.id}/settings"><Icon name="gear" size={16} />Manage feed</Button>
      {/if}
    {/snippet}
  </PageHeader>
  <!-- The feed's numbers, as one line where a description would go, like the counts under New posts. -->
  {#snippet stats()}{#each statsLine(feed!) as part, i (part)}{#if i > 0}{' '}{/if}<span class="stat">{part}{#if i < statsLine(feed!).length - 1}{' '}<Dot />{/if}</span>{/each}{/snippet}
  {#snippet back()}<BackLink href={cameFrom?.href ?? '/explore'} label={cameFrom?.name ?? 'Explore'} stepBack={!!cameFrom} />{/snippet}

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
  /* Room under the picture and name, before the numbers. */
  /* A long line breaks between items, never inside one, and each dot stays at the end of the item before it. */
  .stat { white-space: nowrap; }
  .profile { display: flex; gap: var(--space-3); align-items: center; margin-bottom: var(--space-4); }
  .who { flex: 1; min-width: 0; }
  h1 { flex: 1 1 auto; min-width: 0; font-family: var(--font-headings); font-size: calc(var(--text-2xl) * var(--size-headings)); margin: 0; line-height: 1.15; text-box: trim-both cap alphabetic; overflow-wrap: anywhere; }
  /* 2px is an optical nudge under the title, not a spacing step. */
  /* One line, like the name above it; the words clip themselves, so the link's touch area can still reach past its edges. */
  .host { display: inline-flex; max-width: 100%; font-size: calc(var(--text-sm) * var(--size-app)); color: var(--accent); font-weight: 600; }
  /* The site link sits right under the follow and settings buttons, so its
     touch area grows downward only and leaves theirs whole. */
  @media (pointer: coarse) { .host::after { top: 0; } }
  /* The address, and beside it "Requires subscription" when the site is paywalled; the pill drops under the address when the line runs out. */
  /* The name and address are trimmed to their letters, from the top of the name's capitals to the bottom of the address's letters like y and p, so the picture beside them can match what you see. */
  .hosttext { text-box: trim-both cap text; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .addr { min-width: 0; margin-top: var(--space-2); line-height: 1.3; display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-1) var(--space-2); }
  .banners { display: flex; flex-direction: column; gap: var(--space-2); margin-top: var(--space-4); }
  .river { margin-top: var(--space-4); }
  .status { text-align: center; color: var(--text-2); font-size: calc(var(--text-sm) * var(--size-app)); padding: var(--space-4) 0; margin: 0; }
</style>
