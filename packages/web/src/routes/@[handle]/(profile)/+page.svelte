<script lang="ts">
  /**
   * A profile's Overview, at /@handle: the first few of each section, each
   * ending in a link to its own tab. The owner's Visibility card leads, with
   * every "who sees this" setting in one place.
   */
  import { api, profilesApi, type PublicBookmark } from '$lib/api';
  import { removeBookmark, withBookmarkBack } from '$lib/saves';
  import { getProfileContext, shownTabs, tabHref } from '$lib/profile.svelte';
  import VisibilityCard from '$lib/components/VisibilityCard.svelte';
  import CollectionTree from '$lib/components/CollectionTree.svelte';
  import ActivityList from '$lib/components/ActivityList.svelte';
  import BookmarkCard from '$lib/components/BookmarkCard.svelte';

  const ctx = getProfileContext();
  const profile = $derived(ctx.profile);
  const shown = $derived(shownTabs(profile));
  const COLLECTIONS_SHOWN = 5;
  const ACTIVITY_SHOWN = 5;

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

  const plural = (n: number, one: string) => `${n.toLocaleString()} ${n === 1 ? one : one + 's'}`;
</script>

{#snippet head(title: string, href?: string, link?: string)}
  <div class="head">
    <h2>{title}</h2>
    {#if href && link}<a class="all tap" {href}>{link} <span aria-hidden="true">›</span></a>{/if}
  </div>
{/snippet}

{#if profile.isMe}
  <!-- The line saying who can see the profile, on a card of its own above the settings, as on the Bookmarks tab. -->
  <div class="headcard">{@render ctx.tabLine(true)}</div>
  <VisibilityCard id="visibility" />
{/if}

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
      <p class="status">Press the bookmark on any post to save it, or the note button to write down what you thought of it.</p>
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
    {@render head('Recent activity', tabHref(profile.handle, 'activity'), 'All activity')}
    <ActivityList handle={profile.handle} isMe={profile.isMe} limit={ACTIVITY_SHOWN} />
  </section>
{/if}

{#if shown.size === 1 && !profile.isMe}
  <p class="status">Nothing shared here yet.</p>
{/if}

<style>
  section { margin-bottom: var(--space-5); }
  /* The same card the Bookmarks tab opens with, here holding only the line. */
  .headcard { background: var(--surface); border-radius: var(--radius); box-shadow: var(--shadow); padding-bottom: var(--space-2); margin-bottom: var(--space-3); }
  /* Each section's name, with the way to its full tab at the far end of the same line. */
  .head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-3); margin: 0 0 var(--space-3); }
  h2 { font-size: calc(var(--text-xl) * var(--size-app)); margin: 0; line-height: 1.25; }
  .all { flex: none; color: var(--accent); font-weight: 600; font-size: calc(var(--text-sm) * var(--size-app)); }
  .status { color: var(--text-2); font-size: calc(var(--text-sm) * var(--size-app)); padding: var(--space-2) 0; margin: 0; }
  .saves { display: flex; flex-direction: column; gap: var(--space-3); margin: 0; padding: 0; list-style: none; }
</style>
