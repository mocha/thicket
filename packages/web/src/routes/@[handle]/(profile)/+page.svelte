<script lang="ts">
  /**
   * A profile's Overview, at /@handle: the first few of each section, each
   * ending in a link to its own tab.
   */
  import { api, profilesApi, type PublicBookmark, type PublicUser } from '$lib/api';
  import { removeBookmark, withBookmarkBack } from '$lib/saves';
  import { getProfileContext, shownTabs, tabHref } from '$lib/profile.svelte';
  import CollectionTree from '$lib/components/CollectionTree.svelte';
  import ActivityList from '$lib/components/ActivityList.svelte';
  import BookmarkCard from '$lib/components/BookmarkCard.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import EmptyNote from '$lib/components/EmptyNote.svelte';
  import PeopleList from '$lib/components/PeopleList.svelte';
  import PeopleSheet from '$lib/components/PeopleSheet.svelte';

  const ctx = getProfileContext();
  const profile = $derived(ctx.profile);
  const shown = $derived(shownTabs(profile));
  const COLLECTIONS_SHOWN = 5;
  const ACTIVITY_SHOWN = 5;
  let activityEmpty = $state(false);

  /**
   * A few recent bookmarks, with the notes on them; the rest are on the
   * Bookmarks tab. One section with two audiences (issue #84): the server
   * sends only what this viewer may see.
   *
   * On your own profile they're yours to note and remove, as on My Bookmarks
   * (issue #170). One more than is shown is kept in hand, so removing one
   * moves the next up at once; the list is then fetched again to keep one in
   * hand for the next removal.
   */
  const BOOKMARKS_SHOWN = 3;
  let recentBookmarks = $state<PublicBookmark[] | null>(null);
  const shownBookmarks = $derived(recentBookmarks?.slice(0, BOOKMARKS_SHOWN) ?? null);
  let bookmarksFor = $state<string | undefined>(undefined);
  /* Bumped by every change made here, so a fetch that set out before an Undo can't undo it. */
  let bookmarksAsked = 0;
  function loadBookmarks(h: string) {
    const asked = ++bookmarksAsked;
    return profilesApi.bookmarks(h, { limit: BOOKMARKS_SHOWN + 1 }).then((r) => { if (bookmarksFor === h && asked === bookmarksAsked) recentBookmarks = r.bookmarks; });
  }
  $effect(() => {
    if (!profile.bookmarks || profile.bookmarks.count === 0 || bookmarksFor === profile.handle) return;
    const h = profile.handle;
    bookmarksFor = h; recentBookmarks = null;
    loadBookmarks(h).catch(() => (recentBookmarks = []));
  });
  function removeRecent(b: PublicBookmark) {
    if (!profile.bookmarks || !recentBookmarks) return;
    const counts = profile.bookmarks, h = profile.handle, snapshot = recentBookmarks;
    void removeBookmark(b, 'profile', {
      drop: () => {
        bookmarksAsked++;
        recentBookmarks = (recentBookmarks ?? []).filter((x) => x.id !== b.id);
        counts.count--;
      },
      putBack: (id) => {
        // Undo still restores it; the cards only change if this profile is still the one on screen.
        if (bookmarksFor !== h) return;
        bookmarksAsked++;
        recentBookmarks = withBookmarkBack(recentBookmarks ?? [], snapshot, b.id, id);
        counts.count++;
      }
    }).then(() => loadBookmarks(h)).catch((e) => {
      // The cards on screen stay as they are; only the one moving up is missing.
      api.event('profile_bookmarks_refill_failed', { message: (e instanceof Error ? e.message : String(e)).slice(0, 200) });
    });
  }

  /**
   * A visitor to a profile that shares nothing gets the people it follows
   * instead of a dead end: the one list every public profile shows.
   */
  const nothingShared = $derived(shown.size === 1 && !profile.isMe);
  const name = $derived(profile.displayName ?? `@${profile.handle}`);
  const FOLLOWING_SHOWN = 3;
  let following = $state<PublicUser[] | null>(null);
  let followingFor: string | undefined;
  let peopleOpen = $state(false);
  $effect(() => {
    if (!nothingShared || followingFor === profile.handle) return;
    const h = profile.handle;
    followingFor = h; following = null;
    profilesApi.following(h).then((r) => { if (followingFor === h) following = r.users; }).catch(() => (following = []));
  });

  const plural = (n: number, one: string) => `${n.toLocaleString()} ${n === 1 ? one : one + 's'}`;
</script>

{#snippet head(title: string, href?: string, link?: string)}
  <div class="head">
    <h2>{title}</h2>
    {#if href && link}<a class="all tap" {href}>{link} <span aria-hidden="true">›</span></a>{/if}
  </div>
{/snippet}

{#if shown.has('collections') && profile.collections}
  {@const n = profile.collections.length}
  <section>
    {@render head('Collections', n > 0 ? tabHref(profile.handle, 'collections') : undefined, `All ${plural(n, 'collection')}`)}
    <CollectionTree collections={profile.collections} handle={profile.handle} isMe={profile.isMe} limit={COLLECTIONS_SHOWN} />
  </section>
{/if}

{#if shown.has('bookmarks') && profile.bookmarks}
  {@const n = profile.bookmarks.count}
  <section>
    {@render head('Bookmarks', n > 0 ? tabHref(profile.handle, 'bookmarks') : undefined, `All ${plural(n, 'bookmark')}`)}
    {#if n === 0}
      <EmptyNote icon="bookmarks" text="Press the bookmark on any post to save it, or the note button to write down what you thought of it." />
    {:else if shownBookmarks === null}
      <p class="status">Loading…</p>
    {:else if shownBookmarks.length === 0}
      <p class="status">No bookmarks to show.</p>
    {:else}
      <ul class="saves">
        {#each shownBookmarks as b (b.id)}
          <BookmarkCard {b} mine={profile.isMe} author={profile} onopen={() => api.event('bookmark_opened', { via: 'profile' })}
            action={profile.isMe ? { kind: 'remove', on: true, label: b.note ? 'Remove bookmark and note' : 'Remove bookmark', run: () => removeRecent(b) } : undefined} />
        {/each}
      </ul>
    {/if}
  </section>
{/if}

{#if shown.has('activity')}
  <section>
    {@render head('Recent activity', activityEmpty ? undefined : tabHref(profile.handle, 'activity'), 'All activity')}
    <ActivityList handle={profile.handle} isMe={profile.isMe} limit={ACTIVITY_SHOWN} bind:empty={activityEmpty} />
  </section>
{/if}

{#if nothingShared}
  <!-- Nothing here for a visitor: say so, then offer the one thing every public profile shows, who they follow. -->
  <section class="emptycard">
    <div class="emptyhead">
      <span class="emptyicon"><Icon name="eye-off" size={28} /></span>
      <h2 class="emptytitle">{name} hasn’t shared anything yet</h2>
    </div>
    {#if following && following.length > 0}
      <h3 class="follows">{name} follows</h3>
      <PeopleList people={following.slice(0, FOLLOWING_SHOWN)} />
      {#if following.length > FOLLOWING_SHOWN}
        <button type="button" class="seeall tap" aria-haspopup="dialog" onclick={() => (peopleOpen = true)}>See all {following.length}</button>
      {/if}
    {/if}
  </section>
  {#if peopleOpen}
    <PeopleSheet handle={profile.handle} which="following" isMe={false} people={following ?? undefined} onclose={() => (peopleOpen = false)} />
  {/if}
{/if}

<style>
  section { margin-bottom: var(--space-5); }
  /* Each section's name, with the way to its full tab at the far end of the same line. */
  .head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-3); margin: 0 0 var(--space-3); }
  h2 { font-size: calc(var(--text-xl) * var(--size-app)); margin: 0; line-height: 1.25; }
  .all { flex: none; color: var(--accent); font-weight: 600; font-size: calc(var(--text-sm) * var(--size-app)); }
  .status { color: var(--text-2); font-size: calc(var(--text-sm) * var(--size-app)); padding: var(--space-2) 0; margin: 0; }
  /* The empty profile: a card with the reason, then who they follow. */
  .emptycard { background: var(--surface); border-radius: var(--radius); box-shadow: var(--shadow); overflow: hidden; }
  .emptyhead { display: flex; flex-direction: column; align-items: center; gap: var(--space-3); padding: var(--space-6) var(--space-4) var(--space-5); text-align: center; }
  .emptyicon { color: var(--text-3); line-height: 0; }
  .emptytitle { font-size: calc(var(--text-lg) * var(--size-app)); font-weight: 600; margin: 0; text-wrap: balance; }
  .follows { margin: 0; padding: var(--space-3) var(--space-4) var(--space-2); border-top: 1px solid var(--line); font-size: calc(var(--text-sm) * var(--size-app)); font-weight: 600; color: var(--text-2); }
  .seeall { display: block; width: 100%; padding: var(--space-3) var(--space-4); border-top: 1px solid var(--line); color: var(--accent); font-weight: 600; font-size: calc(var(--text-sm) * var(--size-app)); text-align: center; }
  .saves { display: flex; flex-direction: column; gap: var(--space-3); margin: 0; padding: 0; list-style: none; }
</style>
