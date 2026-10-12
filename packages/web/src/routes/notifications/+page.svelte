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
   * One card per notification, each the piece that kind of thing is
   * everywhere else (issue #274): a post bookmarked or noted is the Bookmark
   * card, saying whose it is; a person is the Person row with Follow; a
   * collection is the Collection row. A mention is the note's Bookmark card,
   * with my own @name highlighted in it. What's new since I last looked
   * carries the same New as an unread post.
   *
   * Opening the page marks everything seen, so the bubble in the sidebar
   * clears. What was new stays highlighted for this visit, so you can still
   * tell which ones they were. Seen is marked up to the moment the list was
   * read, never later, so nothing arriving in between is marked seen unshown.
   */
  import { onMount } from 'svelte';
  import { api, authApi, collectionHref, notificationsApi, profilesApi, type Me, type Notification } from '$lib/api';
  import { setMe } from '$lib/session.svelte';
  import FiltersBox from '$lib/components/FiltersBox.svelte';
  import Sheet from '$lib/components/Sheet.svelte';
  import { showToast } from '$lib/toast.svelte';
  import CollectionRow from '$lib/components/CollectionRow.svelte';
  import PersonRow from '$lib/components/PersonRow.svelte';
  import Badge from '$lib/components/Badge.svelte';
  import Dot from '$lib/components/Dot.svelte';
  import { clearNotifs, loadNotifs } from '$lib/notifications.svelte';
  import { session } from '$lib/session.svelte';
  import { dayKey, dayLabel, longAgo } from '$lib/time';
  import { plural } from '$lib/words';
  import BookmarkCard from '$lib/components/BookmarkCard.svelte';
  import Button from '$lib/components/Button.svelte';

  let items = $state<Notification[] | null>(null);
  let failed = $state<string | null>(null);

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

  /** Follow from a follower's or invitee's row, as on Explore. Every row about that person changes with it. */
  let followBusy = $state<string | null>(null);
  async function toggleFollow(n: Extract<Notification, { kind: 'follow' | 'invite' }>) {
    const p = n.person;
    if (!p || followBusy) return;
    followBusy = p.handle;
    try {
      const r = n.following ? await profilesApi.unfollow(p.handle) : await profilesApi.follow(p.handle);
      for (const m of items ?? []) if ((m.kind === 'follow' || m.kind === 'invite') && m.person?.handle === p.handle) m.following = r.isFollowing;
      api.event(r.isFollowing ? 'user_followed' : 'user_unfollowed', { handle: p.handle, via: 'notifications' });
      showToast(r.isFollowing ? `Following ${p.displayName ?? name(p)}` : `Unfollowed ${p.displayName ?? name(p)}`);
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

{#snippet when(at: string)}<time datetime={at} title={new Date(at).toLocaleString()}>{longAgo(at)}</time>{/snippet}
{#snippet fresh(n: Notification)}{#if n.isNew}{' '}<Badge tone="soft" title="New since you last looked">New</Badge>{/if}{/snippet}

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
  <!-- One card each, under New posts' day headings; today's needs none to look at, but keeps one to be read out.
       Each kind is the piece it is everywhere else: a post is the Bookmark card, a person the Person row, a collection the Collection row. -->
  {#each groups as g (g.key)}
  <section class="day">
    <h2 class={g.key === todayKey ? 'visually-hidden' : 'dayhead'}>{g.label}</h2>
    <!-- A list of cards: a Bookmark card is its own item; a row's card sits in one. -->
    <ul class="cards">
    {#each g.items as n (n.key)}
      {#if n.kind === 'mention' || n.kind === 'reply' || n.kind === 'note' || n.kind === 'bookmark'}
        <!-- Whose it is, in the bottom row; in a note, your own @name is highlighted. -->
        <BookmarkCard b={n.bookmark} author={n.person} saver fresh={n.isNew} onopen={() => api.event('bookmark_opened', { via: 'notifications' })} />
      {:else if n.kind === 'collection'}
        <li><Card kind="list" as="ul" class="list-rows">
          <CollectionRow href={collectionHref(n.person.handle, n.collection.slug)} name={n.collection.name} description={n.collection.description} feedCount={n.collection.feedCount}>
            {#snippet badges()}{@render fresh(n)}{/snippet}
            @{n.person.handle} created this collection {@render when(n.at)} <Dot /> {plural(n.collection.feedCount, 'feed')}
          </CollectionRow>
        </Card></li>
      {:else if (n.kind === 'follow' || n.kind === 'invite') && n.person}
        <li><Card kind="list" as="ul" class="list-rows">
          <PersonRow person={n.person} following={n.following} busy={followBusy === n.person.handle} onfollow={() => toggleFollow(n)}>
            {n.kind === 'follow' ? 'Started following you' : 'Signed up with your invite'} {@render when(n.at)}{@render fresh(n)}
          </PersonRow>
        </Card></li>
      {:else if n.kind === 'invite'}
        <li><Card kind="list" as="ul" class="list-rows"><li class="row-details">Someone signed up with your invite {@render when(n.at)}{@render fresh(n)}</li></Card></li>
      {/if}
    {/each}
    </ul>
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


<style>
  .status { text-align: center; color: var(--text-2); font-size: calc(var(--text-sm) * var(--size-app)); padding: var(--space-4) 0; }

  /* One card per notification, spaced like posts in New posts. */
  .day { display: flex; flex-direction: column; gap: var(--space-3); margin-bottom: var(--space-5); }
  /* The same day heading as New posts, without the sticking. */
  .cards { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-3); }
  .dayhead { margin: 0; font-size: calc(var(--text-base) * var(--size-app)); font-weight: 600; color: var(--text-2); }

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
