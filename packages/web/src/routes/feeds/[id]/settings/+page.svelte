<script lang="ts">
  import PageHeader from '$lib/components/PageHeader.svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { api, adminApi, feedHref, type Feed } from '$lib/api';
  import { hostOf, relativeTime } from '$lib/time';
  import { feedName } from '$lib/feedname';
  import { resetNotice } from '$lib/feedsettings';
  import { loadCollections, namedCollections } from '$lib/collections.svelte';
  import CollectionCheckList from '$lib/components/CollectionCheckList.svelte';
  import SavedNote from '$lib/components/SavedNote.svelte';
  import Banner from '$lib/components/Banner.svelte';
  import BackLink from '$lib/components/BackLink.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import Button from '$lib/components/Button.svelte';
  import Field from '$lib/components/Field.svelte';
  import Input from '$lib/components/Input.svelte';
  import { showToast } from '$lib/toast.svelte';
  import { session } from '$lib/session.svelte';

  /**
   * My settings on one feed, at /feeds/:id/settings. Laid out like managing a
   * collection: a breadcrumb back to the feed as the header,
   * your settings for it, where it is filed, and at the very end the
   * diagnostics, folded behind a question: the raw facts about the feed and a
   * way to fetch it now. Everything above the diagnostics is yours alone. The
   * feed is shared, and nothing here changes it for anyone else.
   */
  const id = $derived(Number(page.params.id));
  let feed = $state<Feed | null>(null);
  let ids = $state<number[]>([]);
  let collectionsSaved = $state(false);
  let loadedId = $state<number | undefined>(undefined);

  const original = $derived(feed ? (feed.title ?? hostOf(feed.url)) : '');
  const hasCollections = $derived(namedCollections().length > 0);

  /** Admin only: removing the feed from the instance, for everyone. The numbers come first, then the button. */
  let removeDialog = $state<HTMLDialogElement | null>(null);
  let impact = $state<Awaited<ReturnType<typeof adminApi.feedImpact>> | null>(null);
  let removing = $state(false);
  let adminOpen = $state(false);
  async function askRemove() {
    if (!feed) return;
    impact = null;
    removeDialog?.showModal();
    try { impact = await adminApi.feedImpact(feed.id); } catch (e) { showToast(e instanceof Error ? e.message : String(e)); removeDialog?.close(); }
  }
  async function confirmRemove() {
    if (!feed || removing) return;
    removing = true;
    try {
      await adminApi.deleteFeed(feed.id);
      api.event('admin_feed_removed', { feedId: feed.id });
      removeDialog?.close();
      showToast(`Removed ${feedName(feed)} from thicket`);
      await loadCollections(true);
      await goto('/explore', { replaceState: true });
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    } finally {
      removing = false;
    }
  }
  let subscriptionChecked = $state(false);
  let savingSubscription = $state(false);
  $effect(() => { subscriptionChecked = feed?.requiresSubscription ?? false; });

  /* One save at a time. Keep the checkbox honest on failure, and never apply
   * a response to another feed if the admin navigated while it was saving. */
  async function setRequiresSubscription(on: boolean) {
    if (!feed || savingSubscription) return;
    const target = feed;
    const previous = target.requiresSubscription;
    savingSubscription = true;
    try {
      const r = await adminApi.setRequiresSubscription(target.id, on);
      api.event('admin_feed_requires_subscription', { feedId: target.id, on: r.requiresSubscription });
      if (feed !== target || id !== target.id) return;
      target.requiresSubscription = r.requiresSubscription;
      subscriptionChecked = r.requiresSubscription;
      showToast(r.requiresSubscription ? `${feedName(target)} is marked as requiring a subscription` : `${feedName(target)} is no longer marked as requiring a subscription`);
    } catch (e) {
      if (feed !== target || id !== target.id) return;
      subscriptionChecked = previous;
      showToast(e instanceof Error ? e.message : String(e));
    } finally {
      savingSubscription = false;
    }
  }
  const n = (v: number, one: string, many: string) => `${v} ${v === 1 ? one : many}`;

  async function load() {
    try {
      feed = await api.feed(id);
    } catch {
      return void goto('/explore', { replaceState: true });
    }
    ids = feed.myCollectionIds;
    diagOpen = feed.consecutiveFailures > 0;
    displayName = feed.displayName ?? '';
  }

  /* Display name: a field with Save inside it, which wakes up once something changed. Saving it empty goes back to the feed's own title. */
  let displayName = $state('');
  let savingName = $state(false);
  const nameDirty = $derived(!!feed && displayName.trim() !== (feed.displayName ?? ''));
  async function saveName(next: string) {
    if (!feed || savingName) return;
    savingName = true;
    try {
      const r = await api.feedSettings(feed.id, { displayName: next.trim() || null });
      feed.displayName = r.displayName;
      displayName = r.displayName ?? '';
      api.event('feed_renamed', { feedId: feed.id, cleared: !r.displayName });
      showToast(r.displayName ? `You’ll see this feed as “${r.displayName}”` : `Back to “${original}”`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    } finally {
      savingName = false;
    }
  }

  /* Shorts: follow my default, or decide for this channel. Saved on change. Changing what is hidden brings the feed page's notice back. */
  async function setShorts(hide: boolean | null) {
    if (!feed || feed.hideShortsSetting === hide) return;
    feed.hideShortsSetting = hide;
    const r = await api.feedSettings(feed.id, { hideShorts: hide });
    feed.hideShortsSetting = r.hideShortsSetting;
    feed.hideShorts = r.hideShorts;
    resetNotice(feed.id);
    api.event('feed_hide_shorts', { feedId: feed.id, hide });
    showToast(hide === null ? 'This channel follows your default again' : hide ? 'Shorts hidden from this channel' : 'Shorts shown on this channel');
  }

  /* Unfollow, beside the feed's name: one click out of every collection; undo puts it back where it was. */
  async function unfollow() {
    if (!feed || ids.length === 0) return;
    const f = feed;
    const prev = ids;
    const removed = await api.unfollow(f.id);
    ids = [];
    void loadCollections(true);
    api.event('feed_unfollowed', { feedId: f.id, via: 'feed_settings' });
    showToast(`Unfollowed ${feedName(f)}`, {
      label: 'Undo',
      run: async () => {
        const r = await api.restore(f.id, removed.collectionIds.length ? removed.collectionIds : prev);
        ids = r.collectionIds;
        void loadCollections(true);
      }
    });
  }

  /* Diagnostics: fetch the feed now. The site may be paused for everyone (it asked thicket to slow down), and then this says so rather than asking again. */
  let diagOpen = $state(false);
  let refreshing = $state(false);
  let refreshNote = $state<{ tone: 'error' | 'info' | 'success'; text: string } | null>(null);
  async function refresh() {
    if (!feed || refreshing) return;
    refreshing = true;
    refreshNote = null;
    try {
      const r = await api.refresh(feed.id);
      if (!r.ok) {
        refreshNote = { tone: 'info', text: r.reason ?? `This feed was fetched a few minutes ago. Try again in ${Math.ceil(r.cooldown / 60)} min.` };
        return;
      }
      // The fetch landed on an address another feed already had, and this one was folded into it (feeds/merge.ts).
      if (r.feedId !== feed.id) {
        showToast('This feed turned out to be the same address as another feed, so they are one feed now');
        return void goto(`/feeds/${r.feedId}/settings`, { replaceState: true });
      }
      const next = await api.feed(feed.id);
      feed = { ...next, displayName: feed.displayName };
      refreshNote = next.consecutiveFailures > 0
        ? { tone: 'error', text: `Fetched, and it failed again: ${next.lastError ?? `HTTP ${next.lastStatus}`}` }
        : { tone: 'success', text: 'Fetched just now.' };
      api.event('feed_refreshed', { feedId: feed.id, via: 'feed_settings' });
    } catch (e) {
      refreshNote = { tone: 'error', text: e instanceof Error ? e.message : String(e) };
    } finally {
      refreshing = false;
    }
  }

  const when = (v: string | null) => (v ? new Date(v).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : null);
  const every = (s: number) => (s < 3600 ? `${Math.round(s / 60)} minutes` : s < 86400 ? `${+(s / 3600).toFixed(1)} hours` : `${+(s / 86400).toFixed(1)} days`);
  const facts = $derived<[string, string | null][]>(feed ? [
    ['Feed URL', feed.url],
    ['Website', feed.siteUrl],
    ['Feed title', feed.title],
    ['Feed description', feed.description],
    ['Format', feed.kind],
    ['Feed number', String(feed.id)],
    ['Added to thicket', when(feed.createdAt)],
    ['Last checked', when(feed.lastFetchedAt)],
    ['Next check', when(feed.nextFetchAt)],
    ['Checked every', every(feed.fetchIntervalS)],
    ['Last response', feed.lastStatus ? `HTTP ${feed.lastStatus}` : null],
    ['Last error', feed.lastError],
    ['Failed checks in a row', String(feed.consecutiveFailures)],
    ['Newest post', when(feed.lastItemAt)],
    ['Posts stored', String(feed.itemCount)],
    ['Followers', String(feed.followerCount)],
    ['ETag', feed.etag],
    ['Last modified', feed.lastModified],
  ] : []);

  $effect(() => {
    if (!session.loaded) return;
    if (!session.user) return void goto(`/login?next=${encodeURIComponent(page.url.pathname)}`, { replaceState: true });
    if (loadedId === id) return;
    loadedId = id;
    feed = null;
    refreshNote = null;
    void load();
    api.event('feed_settings_view', { feedId: id });
  });
</script>

<svelte:head><title>{feed ? `Managing ${feedName(feed)}` : 'Feed settings'} · thicket</title></svelte:head>

{#if feed}
  {@const here = feed}
  <PageHeader name="Manage feed">
    {#snippet above()}<BackLink href={feedHref(here)} label={feedName(here)} />{/snippet}
    {#snippet description()}Its name, collections, and how posts show for you.{/snippet}
    {#snippet actions()}{#if ids.length > 0}<Button variant="danger" size="sm" onclick={unfollow}>Unfollow</Button>{/if}{/snippet}
  </PageHeader>
  <section>
    <form class="opt" onsubmit={(e) => { e.preventDefault(); void saveName(displayName); }}>
      <Field label="Display name" hint="Only you see this name.">
        {#snippet children({ id, describedBy, invalid })}
          <Input {id} aria-describedby={describedBy} {invalid} bind:value={displayName} maxlength={120} placeholder={original} disabled={savingName}>
            {#snippet trailing()}
              <Button type="submit" variant="primary" disabled={!nameDirty || savingName}>{savingName ? 'Saving…' : 'Save'}</Button>
            {/snippet}
          </Input>
        {/snippet}
      </Field>
    </form>

    {#if feed.isYouTube}
      <div class="opt">
        <h2>YouTube Shorts</h2>
        <div class="radios" role="radiogroup" aria-label="YouTube Shorts">
          <label>
            <input type="radio" name="shorts" checked={feed.hideShortsSetting === null} onchange={() => setShorts(null)} />
            <span><strong>Use my default</strong><small>{session.user?.hideShortsByDefault ? 'Videos only' : 'Videos + Shorts'}, as set in <a href="/settings">Settings</a>.</small></span>
          </label>
          <label>
            <input type="radio" name="shorts" checked={feed.hideShortsSetting === true} onchange={() => setShorts(true)} />
            <span><strong>Videos</strong><small>Leave Shorts out wherever you read this channel.</small></span>
          </label>
          <label>
            <input type="radio" name="shorts" checked={feed.hideShortsSetting === false} onchange={() => setShorts(false)} />
            <span><strong>Videos + Shorts</strong><small>Show everything the channel posts.</small></span>
          </label>
        </div>
      </div>
    {/if}
  </section>

  <section class="opt">
    <h2 class="withnote">Collections ({ids.length}) <SavedNote show={collectionsSaved} /></h2>
    <!-- What the list is for, above it, as the Follow sheet does. With no collections yet, the list's own line says how to start one. -->
    {#if hasCollections}<p class="hint lede">Choose the collections this feed appears in. Every feed you follow lives in at least one.</p>{/if}
    <CollectionCheckList feedId={feed.id} bind:ids bind:saved={collectionsSaved} name={feedName(feed)} showHint={!hasCollections} onPage />
  </section>

  <hr />
  <!-- Troubleshooting, shut until asked for: a question to click, then the way to check the feed now and the raw facts about it. A feed whose last check failed arrives open, so the reason is never hidden. -->
  <details class="fold" bind:open={diagOpen}>
    <summary class="tap">
      <Icon name="caret" dir={diagOpen ? 'down' : 'right'} size={16} stroke={2.4} />
      <h2>Not seeing new posts from this feed?</h2>
    </summary>
    <div class="body">
      {#if feed.consecutiveFailures > 0}
        <Banner tone="error">Last fetch failed: {feed.lastError ?? `HTTP ${feed.lastStatus}`}</Banner>
      {/if}
      <div class="row">
        <Button onclick={refresh} disabled={refreshing}>{refreshing ? 'Fetching…' : 'Refresh now'}</Button>
        <span class="hint inline">{feed.lastFetchedAt ? `Last checked ${relativeTime(feed.lastFetchedAt)}` : 'Not fetched yet'}</span>
      </div>
      {#if refreshNote}
        <Banner tone={refreshNote.tone} dismissible ondismiss={() => (refreshNote = null)}>{refreshNote.text}</Banner>
      {/if}
      <ul class="facts">
        {#each facts as [k, v] (k)}
          <li><strong>{k}:</strong> <span>{v ?? '—'}</span></li>
        {/each}
      </ul>
    </div>
  </details>

  {#if session.user?.isAdmin}
    <hr />
    <!-- Admins only, and folded like the troubleshooting above it: what an admin can change about this feed for everyone. First the paywall mark, then removal with what it does. -->
    <details class="fold" bind:open={adminOpen}>
      <summary class="tap">
        <Icon name="caret" dir={adminOpen ? 'down' : 'right'} size={16} stroke={2.4} />
        <h2>Admin: change this feed for everyone</h2>
      </summary>
      <div class="body admin">
        <div class="radios">
          <label>
            <input type="checkbox" bind:checked={subscriptionChecked} disabled={savingSubscription} onchange={(e) => setRequiresSubscription(e.currentTarget.checked)} />
            <span><strong>Requires a subscription</strong><small>The site’s posts are behind a paywall. Everyone sees “Requires subscription” next to this feed’s address.</small></span>
          </label>
        </div>
        <p class="hint">Feeds are shared. Removing this one takes it away from everyone on thicket: its posts and its place in every collection. Bookmarks, and the notes on them, keep their saved copy. Use it for spam, abuse, or a feed that should never have been indexed.</p>
        <Button variant="danger" onclick={askRemove}>Remove from thicket</Button>
      </div>
    </details>

    <dialog bind:this={removeDialog} class="remove" onclick={(e) => { if (e.target === removeDialog) removeDialog?.close(); }} aria-labelledby="remove-title">
      <h2 id="remove-title">Remove {feedName(feed)} from thicket?</h2>
      {#if impact}
        <p>This deletes, for everyone: <strong>{n(impact.posts, 'post', 'posts')}</strong>, and its place in <strong>{n(impact.collections, 'collection', 'collections')}</strong> belonging to <strong>{n(impact.followers, 'person', 'people')}</strong>. {impact.bookmarks ? `${n(impact.bookmarks, 'bookmark keeps', 'bookmarks keep')} ${impact.bookmarks === 1 ? 'its' : 'their'} saved copy and any note, but ${impact.bookmarks === 1 ? 'loses' : 'lose'} the link to the post.` : ''} It cannot be undone; the feed can be added again later, but its older posts may not come back with it.</p>
      {:else}
        <p class="hint">Counting what this would take with it…</p>
      {/if}
      <div class="actions">
        <Button onclick={() => removeDialog?.close()}>Keep it</Button>
        <Button variant="danger" solid onclick={confirmRemove} disabled={!impact || removing}>{removing ? 'Removing…' : 'Remove for everyone'}</Button>
      </div>
    </dialog>
  {/if}
{:else}
  <p class="status">Loading…</p>
{/if}

<style>
  hr { border: 0; border-top: 1px solid var(--line); margin: var(--space-4) 0; }
  /* The breadcrumb is the header and takes the room; Unfollow keeps its size at the right. The min-height holds the row steady when Unfollow isn't shown. */
  /* Section headings match a field's label, so "Display name" and "Collections" read as the same kind of thing. */
  section h2 { font-size: calc(var(--text-base) * var(--size-app)); font-weight: 600; margin: 0 0 var(--space-3); }
  section h2.withnote { display: flex; align-items: center; gap: var(--space-3); }
  /* Between one setting and the next: more than the gap inside a setting, so each reads as its own group. The last one leaves the usual gap before the line under it. */
  .opt { margin-bottom: var(--space-6); }
  section.opt { margin-bottom: var(--space-4); }
  .row { display: flex; align-items: center; gap: var(--space-2); margin-top: var(--space-3); flex-wrap: wrap; }
  .hint { margin: var(--space-2) 0 0; font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); overflow-wrap: anywhere; }
  .hint.inline { margin: 0; }
  /* The line under a section heading: tucked up against it, then the usual gap before what it describes. */
  .hint.lede { margin: calc(var(--space-2) * -1) 0 var(--space-3); }
  .radios { display: flex; flex-direction: column; gap: var(--space-2); }
  .radios label { display: flex; align-items: flex-start; gap: var(--space-3); padding: var(--space-3) var(--space-4); background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-sm); cursor: pointer; }
  .radios label:has(input:checked) { border-color: var(--accent); }
  .radios input { margin-top: var(--space-1); width: 18px; height: 18px; accent-color: var(--accent); flex: none; }
  /* 2px between a choice and its explanation is optical, not a spacing step. */
  .radios span { display: flex; flex-direction: column; gap: 2px; font-size: calc(var(--text-sm) * var(--size-app)); }
  .radios small { font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); }
  .admin { align-items: flex-start; }
  .admin .hint { margin: 0; }
  .admin .radios { align-self: stretch; }
  dialog.remove { max-width: 440px; padding: var(--space-5) var(--space-5) var(--space-4); border: 0; border-radius: var(--radius-md); background: var(--surface); color: var(--text); box-shadow: var(--shadow-dialog); }
  dialog.remove::backdrop { background: var(--scrim); }
  dialog.remove h2 { margin: 0 0 var(--space-3); font-size: calc(var(--text-xl) * var(--size-headings)); font-family: var(--font-headings); }
  dialog.remove p { margin: 0 0 var(--space-4); line-height: 1.5; font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); }
  dialog.remove .actions { display: flex; justify-content: flex-end; gap: var(--space-2); }
  .fold summary { display: flex; align-items: center; gap: var(--space-2); cursor: pointer; list-style: none; color: var(--text-2); }
  .fold summary::-webkit-details-marker { display: none; }
  .fold summary h2 { margin: 0; font-size: calc(var(--text-base) * var(--size-app)); font-weight: 600; color: var(--text); }
  .fold .body { display: flex; flex-direction: column; gap: var(--space-3); margin-top: var(--space-3); }
  .fold .row { margin-top: 0; }
  .facts { margin: 0; padding-left: var(--space-5); display: flex; flex-direction: column; gap: var(--space-2); font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); }
  .facts li { overflow-wrap: anywhere; }
  .facts strong { color: var(--text); font-weight: 600; }
  .status { text-align: center; color: var(--text-2); padding: var(--space-5) 0; margin: 0; font-size: calc(var(--text-sm) * var(--size-app)); }
</style>
