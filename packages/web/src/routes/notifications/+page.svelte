<script lang="ts">
  import Card from '$lib/components/Card.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  /**
   * Notifications (issue #184): the last 30 days of what concerns me, newest
   * first. Someone followed me; someone I follow bookmarked a post or wrote a
   * note on one; someone mentioned me in a note.
   *
   * Most of it is one terse line to skim: who, what, and the post's title
   * linking to the post. A mention is the exception: it was written to me, so
   * it comes in full, the post with the note on it, the same card a profile's
   * bookmarks use.
   *
   * Opening the page marks everything seen, so the bubble in the sidebar
   * clears. What was new stays highlighted for this visit, so you can still
   * tell which ones they were. Seen is marked up to the moment the list was
   * read, never later, so nothing arriving in between is marked seen unshown.
   */
  import { onMount } from 'svelte';
  import { api, notificationsApi, profileHref, type Notification } from '$lib/api';
  import { clearNotifs } from '$lib/notifications.svelte';
  import { session } from '$lib/session.svelte';
  import { dayKey, dayLabel, hostOf, relativeTime, savedHref, ugcRel } from '$lib/time';
  import Avatar from '$lib/components/Avatar.svelte';
  import BookmarkCard from '$lib/components/BookmarkCard.svelte';
  import Button from '$lib/components/Button.svelte';
  import SourceIcon from '$lib/components/SourceIcon.svelte';
  import FeedPopover from '$lib/components/FeedPopover.svelte';

  let items = $state<Notification[] | null>(null);
  let failed = $state<string | null>(null);
  /** The feed whose card is open, from a post line's icon. */
  let source = $state<{ feedId: number | null; hasIcon: boolean; name: string } | null>(null);
  function openSource(feedId: number | null, hasIcon: boolean, name: string) {
    api.event('source_opened', { feedId, via: 'notifications' });
    source = { feedId, hasIcon, name };
  }

  onMount(async () => {
    try {
      const r = await notificationsApi.list();
      items = r.items;
      api.event('notifications_view', { shown: r.items.length, new: r.count });
      if (r.count) {
        await notificationsApi.seen(r.asOf);
        clearNotifs();
      }
    } catch (e) {
      failed = e instanceof Error ? e.message : String(e);
    }
  });

  const name = (p: { handle: string }) => `@${p.handle}`;

  /** Notifications by day, newest first, labeled like New posts' days: "Yesterday", "Monday, October 5". */
  const todayKey = $derived(dayKey(new Date()));
  const groups = $derived.by(() => {
    const out: { key: string; label: string; items: Notification[] }[] = [];
    for (const n of items ?? []) {
      const key = dayKey(new Date(n.at));
      const last = out[out.length - 1];
      if (last && last.key === key) last.items.push(n);
      else out.push({ key, label: dayLabel(key), items: [n] });
    }
    return out;
  });
</script>

<svelte:head><title>Notifications · thicket</title></svelte:head>

<PageHeader name="Notifications">
  {#snippet description()}Followers, mentions, and what the people you follow save.{/snippet}
</PageHeader>

{#snippet who(p: Notification['person'])}
  <a class="who" href={profileHref(p.handle)} title={p.displayName ?? undefined}><Avatar handle={p.handle} name={p.displayName ?? p.handle} size={24} v={p.avatarUpdatedAt} /><span>{name(p)}</span></a>
{/snippet}

{#if failed}
  <p class="status">{failed}</p>
{:else if items === null}
  <p class="status">Loading…</p>
{:else if items.length === 0}
  <div class="empty">
    <h2>Nothing yet</h2>
    <p>When someone follows you, it shows up here. So does every post the people you follow bookmark or write a note on, and any note that mentions you as @{session.user?.handle ?? 'yourhandle'}.</p>
    <div class="ctas"><Button href="/explore">Find people to follow</Button></div>
  </div>
{:else}
  <!-- Grouped by day, under the same headings as New posts; today's needs none to look at, but keeps one to be read out. -->
  {#each groups as g (g.key)}
  <section class="day">
  <h2 class={g.key === todayKey ? 'visually-hidden' : 'dayhead'}>{g.label}</h2>
  <Card kind="list" as="ul">
    {#each g.items as n (n.key)}
      <li class:new={n.isNew} class:rich={n.kind === 'mention'}>
        {#if n.isNew}<span class="visually-hidden">New: </span>{/if}
        {#if n.kind === 'mention'}
          <p class="line">{@render who(n.person)} <span class="verb">mentioned you in a note</span> <time datetime={n.at} title={new Date(n.at).toLocaleString()}>{relativeTime(n.at)}</time></p>
          <ul class="card"><BookmarkCard b={n.bookmark} author={n.person} onopen={() => api.event('bookmark_opened', { via: 'notifications' })} /></ul>
        {:else if n.kind === 'follow'}
          <p class="line">{@render who(n.person)} <span class="verb">started following you</span> <time datetime={n.at} title={new Date(n.at).toLocaleString()}>{relativeTime(n.at)}</time></p>
        {:else}
          <p class="line">
            {@render who(n.person)}
            <span class="verb">{n.kind === 'note' ? 'noted' : 'bookmarked'}</span>
            <button class="source tap" onclick={() => openSource(n.post.feedId, n.post.hasIcon, n.post.siteTitle ?? hostOf(n.post.url))} aria-label="About {n.post.siteTitle ?? hostOf(n.post.url)}" title="About {n.post.siteTitle ?? hostOf(n.post.url)}">
              <SourceIcon feedId={n.post.feedId} hasIcon={n.post.hasIcon} name={n.post.siteTitle ?? hostOf(n.post.url)} size={16} />
            </button>
            <a class="post" href={savedHref(n.post.url) ?? '#'} target="_blank" rel={ugcRel(savedHref(n.post.url))} title={n.post.siteTitle ?? hostOf(n.post.url)}>{n.post.title ?? n.post.url}</a>
            <time datetime={n.at} title={new Date(n.at).toLocaleString()}>{relativeTime(n.at)}</time>
          </p>
        {/if}
      </li>
    {/each}
  </Card>
  </section>
  {/each}
{/if}

{#if source}
  <FeedPopover feedId={source.feedId} hasIcon={source.hasIcon} name={source.name} onclose={() => (source = null)} />
{/if}

<style>
  .status { text-align: center; color: var(--text-2); font-size: calc(var(--text-sm) * var(--size-app)); padding: var(--space-4) 0; }

  /* One card of rows, like Recent activity on a profile: skimmable, one line each. */
  .day { display: flex; flex-direction: column; gap: var(--space-2); margin-bottom: var(--space-4); }
  /* The same day heading as New posts, without the sticking. */
  .dayhead { margin: 0; font-size: calc(var(--text-base) * var(--size-app)); font-weight: 600; color: var(--text-2); }
  .day li { position: relative; padding: var(--space-3) var(--space-4); border-top: 1px solid var(--line); }
  .day li:first-child { border-top: 0; }
  /* New since last time: a tint and an accent edge, so it reads in grayscale too (the edge), not by color alone. */
  .day li.new { background: color-mix(in srgb, var(--accent) 9%, transparent); box-shadow: inset 3px 0 0 var(--accent); }
  .line { display: flex; align-items: center; gap: var(--space-2); margin: 0; min-width: 0; font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); }
  .who { flex: none; display: inline-flex; align-items: center; gap: var(--space-2); color: var(--text); font-weight: 600; }
  @media (hover: hover) { .who:hover span, .post:hover { text-decoration: underline; text-underline-offset: 3px; } }
  .verb { flex: none; }
  .source { flex: none; display: inline-flex; }
  /* The title takes what room is left and trails off; the time stays whole at the end. */
  .post { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); font-weight: 600; }
  time { flex: none; margin-left: auto; padding-left: var(--space-2); color: var(--text-2); }

  /* A mention: the line, then the post with the note on it, as a card inside the row. */
  .card { list-style: none; margin: var(--space-3) 0 0; padding: 0; }

  .empty { text-align: center; padding: calc(var(--space-6) + var(--space-2)) var(--space-5); color: var(--text-2); }
  .empty h2 { font-family: var(--font-headings); color: var(--text); font-size: calc(var(--text-xl) * var(--size-headings)); margin: 0 0 var(--space-2); }
  .empty p { margin: 0 auto; max-width: 440px; font-size: calc(var(--text-base) * var(--size-app)); }
  .ctas { display: flex; gap: var(--space-2); justify-content: center; flex-wrap: wrap; margin-top: var(--space-4); }
</style>
