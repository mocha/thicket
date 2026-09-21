<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { api, adminApi, feedHref, type Feed } from '$lib/api';
  import { hostOf, relativeTime } from '$lib/time';
  import { feedName } from '$lib/feedname';
  import { resetNotice } from '$lib/feedsettings';
  import { loadCollections } from '$lib/collections.svelte';
  import CollectionCheckList from '$lib/components/CollectionCheckList.svelte';
  import Banner from '$lib/components/Banner.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import { showToast } from '$lib/toast.svelte';
  import { session } from '$lib/session.svelte';

  /**
   * My settings on one feed, at /feeds/:id/settings. Laid out like managing a
   * collection: back, what you are managing, your settings for it, where it is
   * filed, and at the very end the diagnostics: the raw facts about the feed
   * and a way to fetch it now. Everything above the diagnostics is yours
   * alone. The feed is shared, and nothing here changes it for anyone else.
   */
  const id = $derived(Number(page.params.id));
  let feed = $state<Feed | null>(null);
  let ids = $state<number[]>([]);
  let loadedId = $state<number | undefined>(undefined);

  const original = $derived(feed ? (feed.title ?? hostOf(feed.url)) : '');

  /** Admin only: removing the feed from the instance, for everyone. The numbers come first, then the button. */
  let removeDialog = $state<HTMLDialogElement | null>(null);
  let impact = $state<Awaited<ReturnType<typeof adminApi.feedImpact>> | null>(null);
  let removing = $state(false);
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
  const n = (v: number, one: string, many: string) => `${v} ${v === 1 ? one : many}`;

  async function load() {
    try {
      feed = await api.feed(id);
    } catch {
      return void goto('/explore', { replaceState: true });
    }
    ids = feed.myCollectionIds;
    displayName = feed.displayName ?? '';
  }

  /* Display name: a field whose Save wakes up once something changed. Empty goes back to the feed's own title. */
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

  /* One click out of every collection, which is unfollowing; undo puts it back where it was. */
  async function removeFromAll() {
    if (!feed || ids.length === 0) return;
    const f = feed;
    const prev = ids;
    const removed = await api.unfollow(f.id);
    ids = [];
    void loadCollections(true);
    api.event('feed_unfollowed', { feedId: f.id, via: 'feed_settings' });
    showToast(`Removed ${feedName(f)} from all your collections`, {
      label: 'Undo',
      run: async () => {
        const r = await api.restore(f.id, removed.collectionIds.length ? removed.collectionIds : prev);
        ids = r.collectionIds;
        void loadCollections(true);
      }
    });
  }

  /* Diagnostics: fetch the feed now. The site may be paused for everyone (it asked thicket to slow down), and then this says so rather than asking again. */
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
  <a class="back" href={feedHref(feed)}>
    <Icon name="back" size={16} stroke={2.4} />
    Back to feed
  </a>

  <header class="top">
    <p class="pre">Managing feed:</p>
    <h1>{feedName(feed)}</h1>
  </header>

  <hr />
  <section>
    <h2>Settings</h2>

    <div class="opt">
      <h3><label for="dname">Display name</label></h3>
      <form onsubmit={(e) => { e.preventDefault(); void saveName(displayName); }}>
        <input id="dname" type="text" bind:value={displayName} maxlength="120" placeholder={original} disabled={savingName} />
        <div class="row">
          <button type="submit" class="btn primary" disabled={!nameDirty || savingName}>{savingName ? 'Saving…' : 'Save'}</button>
          {#if feed.displayName}
            <button type="button" class="btn" onclick={() => saveName('')} disabled={savingName}>Use “{original}”</button>
          {/if}
        </div>
      </form>
      <p class="hint">Only you see this name. Where feeds are listed to choose from, it shows as “Your name ({original})”.</p>
    </div>

    {#if feed.isYouTube}
      <div class="opt">
        <h3>YouTube Shorts</h3>
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
    <h2>Collections ({ids.length})</h2>
    <div class="card">
      <CollectionCheckList feedId={feed.id} bind:ids name={feedName(feed)} />
    </div>
    <button class="btn danger" onclick={removeFromAll} disabled={ids.length === 0}>Remove from all collections</button>
  </section>

  <hr />
  <section class="diag">
    <h2>Diagnostics</h2>
    {#if feed.consecutiveFailures > 0}
      <Banner tone="error">Last fetch failed: {feed.lastError ?? `HTTP ${feed.lastStatus}`}</Banner>
    {/if}
    <div class="row">
      <button class="btn" onclick={refresh} disabled={refreshing}>{refreshing ? 'Fetching…' : 'Refresh now'}</button>
      <span class="hint inline">{feed.lastFetchedAt ? `Last checked ${relativeTime(feed.lastFetchedAt)}` : 'Not fetched yet'}</span>
    </div>
    {#if refreshNote}
      <Banner tone={refreshNote.tone} dismissible ondismiss={() => (refreshNote = null)}>{refreshNote.text}</Banner>
    {/if}

    <details class="facts">
      <summary>
        Feed metadata
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      </summary>
      <ul>
        {#each facts as [k, v] (k)}
          <li><strong>{k}:</strong> <span class:none={v === null}>{v ?? '—'}</span></li>
        {/each}
      </ul>
    </details>
  </section>

  {#if session.user?.isAdmin}
    <hr />
    <section class="admin">
      <h2>Admin</h2>
      <p class="hint">Feeds are shared. Removing this one takes it away from everyone on this instance: its posts, the notes on them, and its place in every collection. Bookmarks keep their address. Use it for spam, abuse, or a feed that should never have been indexed.</p>
      <button class="btn danger" onclick={askRemove}>Remove this feed from thicket</button>
    </section>

    <dialog bind:this={removeDialog} class="remove" onclick={(e) => { if (e.target === removeDialog) removeDialog?.close(); }} aria-labelledby="remove-title">
      <h2 id="remove-title">Remove {feedName(feed)} from thicket?</h2>
      {#if impact}
        <p>This deletes, for everyone: <strong>{n(impact.posts, 'post', 'posts')}</strong>, <strong>{n(impact.notes, 'note', 'notes')}</strong> written on them, and its place in <strong>{n(impact.collections, 'collection', 'collections')}</strong> belonging to <strong>{n(impact.followers, 'person', 'people')}</strong>. {impact.bookmarks ? `${n(impact.bookmarks, 'bookmark keeps', 'bookmarks keep')} the address but ${impact.bookmarks === 1 ? 'loses' : 'lose'} the link to the post.` : ''} It cannot be undone; the feed can be added again later, but the notes cannot.</p>
      {:else}
        <p class="hint">Counting what this would take with it…</p>
      {/if}
      <div class="actions">
        <button class="btn" onclick={() => removeDialog?.close()}>Keep it</button>
        <button class="btn danger solid" onclick={confirmRemove} disabled={!impact || removing}>{removing ? 'Removing…' : 'Remove for everyone'}</button>
      </div>
    </dialog>
  {/if}
{:else}
  <p class="status">Loading…</p>
{/if}

<style>
  .back { display: inline-flex; align-items: center; gap: 4px; font-size: calc(14px * var(--size-app)); font-weight: 600; color: var(--accent); padding: 6px 0; margin-bottom: 8px; }
  .top { margin-bottom: 6px; }
  .pre { margin: 0; font-size: calc(12px * var(--size-app)); text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-3); }
  h1 { font-family: var(--font-headings); font-size: calc(28px * var(--size-headings)); margin: 2px 0 0; overflow-wrap: anywhere; }
  hr { border: 0; border-top: 1px solid var(--line); margin: 18px 0; }
  section > h2 { font-size: calc(15px * var(--size-app)); margin: 0 0 12px; }
  .opt { margin-bottom: 18px; }
  h3 { font-size: calc(14px * var(--size-app)); font-weight: 600; margin: 0 0 8px; }
  input[type='text'] { width: 100%; font: inherit; font-size: calc(15px * var(--size-app)); padding: 10px 12px; border-radius: 10px; border: 1px solid var(--line); background: var(--surface); color: var(--text); }
  input[type='text']:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
  input[type='text']::placeholder { color: var(--text-3); }
  .row { display: flex; align-items: center; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
  .hint { margin: 8px 0 0; font-size: calc(13px * var(--size-app)); color: var(--text-3); overflow-wrap: anywhere; }
  .hint.inline { margin: 0; }
  .radios { display: flex; flex-direction: column; gap: 8px; }
  .radios label { display: flex; align-items: flex-start; gap: 12px; padding: 12px 14px; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-sm); cursor: pointer; }
  .radios label:has(input:checked) { border-color: var(--accent); }
  .radios input { margin-top: 3px; width: 18px; height: 18px; accent-color: var(--accent); flex: none; }
  .radios span { display: flex; flex-direction: column; gap: 2px; font-size: calc(14px * var(--size-app)); }
  .radios small { font-size: calc(13px * var(--size-app)); color: var(--text-3); }
  .card { background: var(--surface); border-radius: var(--radius); box-shadow: var(--shadow); padding: 4px 14px 12px; margin-bottom: 12px; }
  .btn { padding: 9px 14px; border-radius: 999px; border: 1px solid var(--line); background: var(--surface); font-size: calc(14px * var(--size-app)); font-weight: 600; color: var(--text-2); }
  .btn.primary { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
  .btn.danger { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 40%, transparent); }
  .btn:disabled { opacity: 0.5; }
  .btn.danger.solid { background: var(--danger); color: #fff; border-color: var(--danger); }
  .admin { display: flex; flex-direction: column; gap: 12px; align-items: flex-start; }
  .admin > h2 { margin: 0; }
  dialog.remove { max-width: 440px; padding: 22px 22px 18px; border: 1px solid var(--line); border-radius: 14px; background: var(--surface); color: var(--text); box-shadow: 0 20px 60px rgba(0, 0, 0, 0.25); }
  dialog.remove::backdrop { background: rgba(0, 0, 0, 0.45); }
  dialog.remove h2 { margin: 0 0 10px; font-size: calc(18px * var(--size-headings)); font-family: var(--font-headings); }
  dialog.remove p { margin: 0 0 16px; line-height: 1.5; font-size: calc(14px * var(--size-app)); color: var(--text-2); }
  dialog.remove .actions { display: flex; justify-content: flex-end; gap: 8px; }
  .diag { display: flex; flex-direction: column; gap: 12px; }
  .diag > h2 { margin: 0; }
  .diag .row { margin-top: 0; }
  .facts summary { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; font-size: calc(15px * var(--size-app)); font-weight: 600; list-style: none; }
  .facts summary::-webkit-details-marker { display: none; }
  .facts summary svg { transition: transform 150ms ease; color: var(--text-3); }
  .facts[open] summary svg { transform: rotate(180deg); }
  .facts ul { margin: 12px 0 0; padding-left: 20px; display: flex; flex-direction: column; gap: 6px; font-size: calc(13px * var(--size-app)); color: var(--text-2); }
  .facts li { overflow-wrap: anywhere; }
  .facts strong { color: var(--text); font-weight: 600; }
  .facts .none { color: var(--text-3); }
  .status { text-align: center; color: var(--text-3); padding: 24px 0; margin: 0; font-size: calc(14px * var(--size-app)); }
</style>
