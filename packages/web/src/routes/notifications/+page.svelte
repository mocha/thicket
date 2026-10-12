<script lang="ts">
  import Card from '$lib/components/Card.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  /**
   * Notifications (issue #184): the last 30 days of what concerns me, newest
   * first. Someone followed me or signed up with my invite; someone I follow
   * bookmarked a post, wrote a note on one, or made a collection; someone
   * mentioned me in a note or noted a post I saved. Which of these I get is
   * mine to choose in Settings (issue #274).
   *
   * Most of it is one terse line to skim: who, what, and the post's title
   * linking to the post. What was written to me or about my posts comes in
   * full, the post with the note on it, the same content a profile's Bookmark
   * cards show, drawn flat inside its row. A mention also carries a note mark
   * on the writer's picture, so it stands out without a second tint (the tint
   * means "new"). Each row offers its next step: Follow back, Read note, or
   * the collection itself.
   *
   * Opening the page marks everything seen, so the bubble in the sidebar
   * clears. What was new stays highlighted for this visit, so you can still
   * tell which ones they were. Seen is marked up to the moment the list was
   * read, never later, so nothing arriving in between is marked seen unshown.
   */
  import { onMount } from 'svelte';
  import { api, authApi, collectionHref, notificationsApi, profileHref, profilesApi, type Me, type Notification } from '$lib/api';
  import { setMe } from '$lib/session.svelte';
  import FiltersBox from '$lib/components/FiltersBox.svelte';
  import Sheet from '$lib/components/Sheet.svelte';
  import { showToast } from '$lib/toast.svelte';
  import CollectionRow from '$lib/components/CollectionRow.svelte';
  import FollowButton from '$lib/components/FollowButton.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import { clearNotifs, loadNotifs } from '$lib/notifications.svelte';
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

  /** What was new when the page opened. It stays highlighted through this visit, even when a filter change reads the list again. */
  const wasNew = new Set<string>();
  async function load(first: boolean) {
    const r = await notificationsApi.list();
    for (const n of r.items) if (n.isNew) wasNew.add(n.key);
    items = r.items.map((n) => ({ ...n, isNew: wasNew.has(n.key) }));
    if (first) api.event('notifications_view', { shown: r.items.length, new: r.count });
    if (r.count) {
      await notificationsApi.seen(r.asOf);
      clearNotifs();
    }
  }

  onMount(async () => {
    try {
      await load(true);
    } catch (e) {
      failed = e instanceof Error ? e.message : String(e);
    }
  });

  /*
   * Filters (issue #274): which kinds I get, kept on my account, so they're
   * the same on every device. A change saves at once, then the list and the
   * bubble in the left menu are read again, so what I turned off is gone from
   * both right away.
   */
  type Pref = 'notifyFollows' | 'notifyInvites' | 'notifyBookmarks' | 'notifyNotes' | 'notifyCollections' | 'notifyReplies';
  const me = $derived(session.user);
  const KIND_PREFS = $derived<{ key: Pref; label: string; hint?: string }[]>([
    { key: 'notifyFollows', label: 'New followers' },
    // Only admins can make invites, so only they are asked, or anyone with an invite sign-up to hear about (an admin no longer).
    ...(me?.isAdmin || !me?.notifyInvites || items?.some((n) => n.kind === 'invite') ? [{ key: 'notifyInvites' as const, label: 'People who sign up with your invite' }] : []),
    { key: 'notifyBookmarks', label: 'Bookmarks by people you follow' },
    { key: 'notifyNotes', label: 'Notes by people you follow' },
    { key: 'notifyCollections', label: 'New collections by people you follow' },
    { key: 'notifyReplies', label: 'Notes on posts you saved', hint: 'Starts off, since a popular post can draw a lot of notes' }
  ]);
  const MENTIONS: { value: Me['mentionsFrom']; label: string; hint?: string; summary: string }[] = [
    { value: 'none', label: 'No one', summary: 'No mentions' },
    { value: 'following', label: 'People I follow', summary: 'Mentions from people I follow' },
    { value: 'everyone', label: 'Everyone', hint: 'The default. Anyone who can see your profile can mention you.', summary: 'Mentions from everyone' }
  ];
  const filterSummary = $derived.by(() => {
    if (!me) return [];
    const off = KIND_PREFS.filter((k) => !me[k.key]);
    const kinds = off.length === 0 ? 'Every kind' : off.length === 1 ? `All but ${off[0].label.toLowerCase()}` : `${KIND_PREFS.length - off.length} of ${KIND_PREFS.length} kinds`;
    return [kinds, MENTIONS.find((m) => m.value === me.mentionsFrom)?.summary ?? ''];
  });
  let filtersDialog = $state<HTMLDialogElement | null>(null);
  let saving = $state(false);
  async function setPref(patch: Parameters<typeof authApi.update>[0]) {
    saving = true;
    try {
      setMe(await authApi.update(patch));
      api.event('notification_filters_changed', { keys: Object.keys(patch) });
      // Reading the list marks it seen and clears the bubble; counting after it means the bubble can't come back stale.
      await load(false);
      await loadNotifs(true);
    } catch (e) {
      // Put the boxes back to what's saved: the one pressed already shows the change that failed.
      if (session.user) setMe({ ...session.user });
      showToast(e instanceof Error ? e.message : String(e));
    } finally { saving = false; }
  }

  const name = (p: { handle: string }) => `@${p.handle}`;

  /** Follow back from a follower's or invitee's row. The button leaves every row about that person once it's done. */
  let followBusy = $state<string | null>(null);
  async function followBack(n: Extract<Notification, { kind: 'follow' | 'invite' }>) {
    const p = n.person;
    if (!p || followBusy) return;
    followBusy = p.handle;
    try {
      const r = await profilesApi.follow(p.handle);
      for (const m of items ?? []) if ((m.kind === 'follow' || m.kind === 'invite') && m.person?.handle === p.handle) m.following = r.isFollowing;
      api.event('user_followed', { handle: p.handle, via: 'notifications' });
      showToast(`Following ${p.displayName ?? name(p)}`);
    } catch (e) { showToast(e instanceof Error ? e.message : String(e)); } finally { followBusy = null; }
  }

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

{#snippet who(p: NonNullable<Notification['person']>, mark = false)}
  <a class="who" href={profileHref(p.handle)} title={p.displayName ?? undefined}><span class="pic"><Avatar handle={p.handle} name={p.displayName ?? p.handle} size={24} v={p.avatarUpdatedAt} />{#if mark}<span class="mark" aria-hidden="true"><Icon name="note" size={10} stroke={2.5} fill /></span>{/if}</span><span>{name(p)}</span></a>
{/snippet}
{#snippet when(at: string)}<time datetime={at} title={new Date(at).toLocaleString()}>{relativeTime(at)}</time>{/snippet}
{#snippet follow(n: Extract<Notification, { kind: 'follow' | 'invite' }>, label: string)}
  <FollowButton following={n.following} label={label} busy={followBusy === n.person?.handle} onclick={() => followBack(n)} />
{/snippet}

{#if me}<FiltersBox summary={filterSummary} onclick={() => filtersDialog?.showModal()} />{/if}

{#if failed}
  <p class="status">{failed}</p>
{:else if items === null}
  <p class="status">Loading…</p>
{:else if items.length === 0}
  <div class="empty">
    <h2>Nothing yet</h2>
    <p>When someone follows you, it shows up here. So does every post the people you follow bookmark or write a note on, and any note that mentions you as @{session.user?.handle ?? 'yourhandle'}.{#if filterSummary[0] !== 'Every kind' || me?.mentionsFrom !== 'everyone'} Some of these are turned off in Filters.{/if}</p>
    <div class="ctas"><Button href="/explore?scope=people">Find people to follow</Button></div>
  </div>
{:else}
  <!-- Grouped by day, under the same headings as New posts; today's needs none to look at, but keeps one to be read out. -->
  {#each groups as g (g.key)}
  <section class="day">
  <h2 class={g.key === todayKey ? 'visually-hidden' : 'dayhead'}>{g.label}</h2>
  <Card kind="list" as="ul" class="list-rows">
    {#each g.items as n (n.key)}
      <li class:new={n.isNew} class:rich={n.kind === 'mention' || n.kind === 'reply' || n.kind === 'collection'} class:mention={n.kind === 'mention'}>
        {#if n.isNew}<span class="visually-hidden">New: </span>{/if}
        {#if n.kind === 'mention' || n.kind === 'reply'}
          <p class="line row-event">{@render who(n.person, n.kind === 'mention')} <span class="verb">{n.kind === 'mention' ? 'mentioned you' : 'noted a post you saved'}</span> {@render when(n.at)}</p>
          <BookmarkCard flat b={n.bookmark} author={n.person} onopen={() => api.event('bookmark_opened', { via: 'notifications' })} />
        {:else if n.kind === 'collection'}
          <p class="line row-event">{@render who(n.person)} <span class="verb">made a collection</span> {@render when(n.at)}</p>
          <ul class="nested-list"><CollectionRow href={collectionHref(n.person.handle, n.collection.slug)} name={n.collection.name} description={n.collection.description} feedCount={n.collection.feedCount} /></ul>
        {:else if n.kind === 'follow'}
          <p class="line row-event">{@render who(n.person)} <span class="verb">started following you</span> {#if !n.following}<span class="act">{@render follow(n, 'Follow back')}</span>{/if}{@render when(n.at)}</p>
        {:else if n.kind === 'invite'}
          {#if n.person}
            <p class="line row-event">{@render who(n.person)} <span class="verb">signed up with your invite</span> {#if !n.following}<span class="act">{@render follow(n, 'Follow')}</span>{/if}{@render when(n.at)}</p>
          {:else}
            <p class="line row-event"><span class="verb">Someone signed up with your invite</span> {@render when(n.at)}</p>
          {/if}
        {:else}
          <p class="line row-event">
            {@render who(n.person)}
            <span class="verb">{n.kind === 'note' ? 'noted' : 'bookmarked'}</span>
            <button class="source tap" onclick={() => openSource(n.post.feedId, n.post.hasIcon, n.post.siteTitle ?? hostOf(n.post.url))} aria-label="About {n.post.siteTitle ?? hostOf(n.post.url)}" title="About {n.post.siteTitle ?? hostOf(n.post.url)}">
              <SourceIcon feedId={n.post.feedId} hasIcon={n.post.hasIcon} name={n.post.siteTitle ?? hostOf(n.post.url)} size={16} />
            </button>
            <a class="post" href={savedHref(n.post.url) ?? '#'} target="_blank" rel={ugcRel(savedHref(n.post.url))} title={n.post.siteTitle ?? hostOf(n.post.url)}>{n.post.title ?? n.post.url}</a>
            {#if n.kind === 'note'}<span class="act"><Button size="sm" href="{profileHref(n.person.handle)}/bookmarks?notes=1">Read note</Button></span>{/if}
            {@render when(n.at)}
          </p>
        {/if}
      </li>
    {/each}
  </Card>
  </section>
  {/each}
{/if}

{#if me}
  <Sheet title="Filters" lede="Choose what shows up in Notifications." bind:dialog={filtersDialog}>
    <fieldset disabled={saving}>
      <legend class="visually-hidden">Kinds of notification</legend>
      {#each KIND_PREFS as k (k.key)}
        <label class="switch">
          <input type="checkbox" checked={me[k.key]} onchange={(e) => setPref({ [k.key]: e.currentTarget.checked })} />
          <span><strong>{k.label}</strong>{#if k.hint}<small>{k.hint}</small>{/if}</span>
        </label>
      {/each}
    </fieldset>
    <fieldset disabled={saving}>
      <legend class="legend">Mentions from</legend>
      {#each MENTIONS as m (m.value)}
        <label class="radio">
          <input type="radio" name="mentionsFrom" value={m.value} checked={me.mentionsFrom === m.value} onchange={() => setPref({ mentionsFrom: m.value })} />
          <span><strong>{m.label}</strong>{#if m.hint}<small>{m.hint}</small>{/if}</span>
        </label>
      {/each}
    </fieldset>
  </Sheet>
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
  .day li { position: relative; }
  /* A mention runs edge to edge: its line keeps the row's inset, and the post under it brings its own, the same as on its card. */
  .day li.rich { padding-left: 0; padding-right: 0; padding-bottom: 0; }
  .rich .line { padding: 0 var(--card-pad); }
  /* The collection keeps its own row, inset like any row, under the line that says who made it. */
  .nested-list { list-style: none; margin: 0; padding: 0; }
  /* A mention: the writer's picture carries a note mark, so it reads as written to me even once it's no longer new. */
  .pic { position: relative; display: inline-flex; flex: none; }
  /* The same corner mark as the edit badge on a profile picture. */
  .mark { position: absolute; right: -4px; bottom: -4px; display: grid; place-items: center; width: 14px; height: 14px; border-radius: var(--radius-pill); background: var(--accent); color: var(--accent-ink); box-shadow: 0 0 0 2px var(--surface); }
  .mention .verb { color: var(--accent); font-weight: 600; }
  /* The next step sits at the end of the line, before the time, like Follow on a person's row. */
  .act { flex: none; margin-left: auto; }
  .act + time { margin-left: 0; }
  /* On a phone it drops under the line, lined up with the name, as Follow does on a person's row. */
  @media (max-width: 560px) {
    .line:has(.act) { flex-wrap: wrap; row-gap: var(--space-2); }
    /* The post title still shares the first line with who did it, trailing off as before. */
    .line:has(.act) .post { flex-basis: 0; }
    .act { order: 1; flex-basis: 100%; margin-left: calc(24px + var(--space-2)); }
    .act + time { margin-left: auto; }
  }
  /* New since last time: a tint and an accent edge, so it reads in grayscale too (the edge), not by color alone. */
  .day li.new { background: color-mix(in srgb, var(--accent) 9%, transparent); box-shadow: inset 3px 0 0 var(--accent); }
  .line { display: flex; align-items: center; gap: var(--space-2); margin: 0; min-width: 0; }
  .who { flex: none; display: inline-flex; align-items: center; gap: var(--space-2); color: var(--text); font-weight: 600; }
  @media (hover: hover) { .who:hover span, .post:hover { text-decoration: underline; text-underline-offset: 3px; } }
  .verb { flex: none; }
  .source { flex: none; display: inline-flex; }
  /* The title takes what room is left and trails off; the time stays whole at the end. */
  .post { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); font-weight: 600; }
  time { flex: none; margin-left: auto; padding-left: var(--space-2); color: var(--text-2); }

  /* The Sheet's choices: the same tick boxes and dials as Settings. */
  fieldset { border: 0; padding: 0; margin: var(--space-3) 0 var(--space-5); display: flex; flex-direction: column; gap: var(--space-3); }
  fieldset:last-of-type { margin-bottom: 0; }
  .legend { padding: 0; margin-bottom: var(--space-1); font-weight: 600; color: var(--text); }
  .radio, .switch { display: flex; flex-direction: row; align-items: flex-start; gap: var(--space-3); font-size: calc(var(--text-sm) * var(--size-app)); font-weight: 400; color: var(--text); cursor: pointer; }
  .radio input, .switch input { margin-top: var(--space-1); width: 18px; height: 18px; accent-color: var(--accent); flex: none; }
  .radio input:focus-visible, .switch input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .radio span, .switch span { display: flex; flex-direction: column; gap: 2px; }
  .radio small, .switch small { font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); }

  .empty { text-align: center; padding: calc(var(--space-6) + var(--space-2)) var(--space-5); color: var(--text-2); }
  .empty h2 { font-family: var(--font-headings); color: var(--text); font-size: calc(var(--text-xl) * var(--size-headings)); margin: 0 0 var(--space-2); }
  .empty p { margin: 0 auto; max-width: 440px; font-size: calc(var(--text-base) * var(--size-app)); }
  .ctas { display: flex; gap: var(--space-2); justify-content: center; flex-wrap: wrap; margin-top: var(--space-4); }
</style>
