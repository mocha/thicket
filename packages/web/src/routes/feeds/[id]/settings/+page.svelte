<script lang="ts">
  import PageHeader from '$lib/components/PageHeader.svelte';
  import { page } from '$app/state';
  import { tick } from 'svelte';
  import { goto } from '$app/navigation';
  import { api, adminApi, feedHref, type AdminFetch, type Feed, type FeedMove, type FeedCategories } from '$lib/api';
  import { hostOf, longAgo } from '$lib/time';
  import { diagnose, checkLabel, BROKEN_AFTER } from '$lib/feedhealth';
  import { feedName } from '$lib/feedname';
  import { plural } from '$lib/words';
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
  import Sheet from '$lib/components/Sheet.svelte';
  import CategoryTerms from '$lib/components/CategoryTerms.svelte';
  import Card from '$lib/components/Card.svelte';
  import CardFooter from '$lib/components/CardFooter.svelte';
  import SettingRow from '$lib/components/SettingRow.svelte';
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
  /** Reached from the admin feed list (its links carry ?admin), as opposed to from the feed itself. */
  const fromAdmin = $derived(page.url.searchParams.has('admin'));
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
      // Back to the list the feed was reached from: Admin's feeds when it was, otherwise Explore's, where its page would now send anyone.
      await goto(fromAdmin ? '/admin?tab=feeds' : '/explore?scope=feeds', { replaceState: true });
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    } finally {
      removing = false;
    }
  }
  /* Admin: the feed's title for everyone. Empty hands it back to the feed, whose own title returns on its next check. */
  let adminTitle = $state('');
  let savingTitle = $state(false);
  let titleError = $state<string | null>(null);
  const titleDirty = $derived(!!feed && adminTitle.trim() !== (feed.title ?? ''));
  async function saveTitle() {
    if (!feed || savingTitle) return;
    const target = feed;
    savingTitle = true; titleError = null;
    try {
      const r = await adminApi.setFeedTitle(target.id, adminTitle.trim() || null);
      api.event('admin_feed_retitled', { feedId: target.id, cleared: !r.title });
      if (feed !== target) return;
      target.title = r.title;
      adminTitle = r.title ?? '';
      showToast(r.title ? `Everyone sees this feed as “${r.title}” now` : 'The feed’s own title comes back on its next check');
    } catch (e) {
      if (feed === target) titleError = e instanceof Error ? e.message : String(e);
    } finally {
      savingTitle = false;
    }
  }

  /* Admin: a new address for the feed. It may land on a feed thicket already has, and then this one is folded into it. */
  let newUrl = $state('');
  let addressInput = $state<HTMLInputElement | null>(null);
  let addressDialog = $state<HTMLDialogElement | null>(null);
  let moving = $state(false);
  /** From the alert, or from "Change this feed for everyone": a Sheet with the address selected, ready to paste over. */
  async function openAddress() {
    if (!feed) return;
    newUrl = feed.url;
    moveNote = null;
    candidates = [];
    addressDialog?.showModal();
    await tick();
    addressInput?.focus();
    addressInput?.select();
  }

  let moveNote = $state<{ tone: 'error' | 'info' | 'success'; text: string } | null>(null);
  let candidates = $state<Extract<FeedMove, { status: 'choose' }>['candidates']>([]);
  async function move(url: string) {
    if (!feed || moving || !url.trim()) return;
    const target = feed;
    moving = true;
    moveNote = null;
    candidates = [];
    try {
      const r = await adminApi.moveFeed(target.id, url.trim());
      if (r.status === 'choose') {
        candidates = r.candidates;
        moveNote = { tone: 'info', text: 'That page lists more than one feed. Pick the one to use.' };
        return;
      }
      api.event('admin_feed_moved', { feedId: target.id, result: r.status, into: r.feedId });
      if (r.status === 'merged' || r.feedId !== target.id) {
        showToast(`${feedName(target)} was folded into the feed already at that address`);
        return void goto(`/feeds/${r.feedId}/settings?admin`, { replaceState: true });
      }
      const next = await api.feed(target.id);
      if (feed !== target) return;
      feed = { ...next, displayName: target.displayName };
      newUrl = next.url;
      adminTitle = next.title ?? '';
      fetches = null;
      if (diagOpen) void loadFetches();
      // Moved: the Sheet's job is done. The alert at the top, or its absence, says how the new address is doing.
      addressDialog?.close();
      showToast(r.fetch.error
        ? `Moved to ${r.url}, but checking it failed`
        : r.fetch.status === null
          ? `Moved to ${r.url}. The site asked us to wait, so it’ll be checked shortly`
          : `Moved to ${r.url}: ${plural(r.fetch.itemsNew, 'new post')}`);
    } catch (e) {
      moveNote = { tone: 'error', text: e instanceof Error ? e.message : String(e) };
    } finally {
      moving = false;
    }
  }

  /* Admin: the feed's recent checks, read when the admin section opens. */
  let fetches = $state<AdminFetch[] | null>(null);
  let fetchWindow = $state(14);
  /** The latest dozen checks first; Show more shows the rest. */
  let fetchesShown = $state(12);
  const shownFetches = $derived(fetches ? fetches.slice(0, fetchesShown) : []);
  let fetchesError = $state<string | null>(null);
  let loadingFetches = $state(false);
  async function loadFetches() {
    if (!feed || loadingFetches) return;
    const target = feed.id;
    loadingFetches = true; fetchesError = null;
    try {
      const r = await adminApi.feedFetches(target);
      if (feed?.id !== target) return;
      fetches = r.fetches;
      fetchWindow = r.windowDays;
    } catch (e) {
      if (feed?.id === target) fetchesError = e instanceof Error ? e.message : String(e);
    } finally {
      loadingFetches = false;
    }
  }
  $effect(() => { if (diagOpen && session.user?.isAdmin && feed && fetches === null && !fetchesError) void loadFetches(); });
  /* Dates as people say them: "Today, 3:00 PM", "Oct 12, 8:46 PM", and the year only when it isn't this one. */
  const thisYear = (d: Date) => d.getFullYear() === new Date().getFullYear();
  const day = (v: string) => { const d = new Date(v); return d.toLocaleDateString(undefined, thisYear(d) ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' }); };
  const moment = (v: string) => {
    const d = new Date(v);
    const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    return `${d.toDateString() === new Date().toDateString() ? 'Today' : day(v)}, ${time}`;
  };
  /** An address without its "https://", "www." or a trailing slash. */
  const bare = (url: string) => url.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');

  async function load() {
    try {
      feed = await api.feed(id);
    } catch {
      return void goto('/explore?scope=feeds', { replaceState: true });
    }
    ids = feed.myCollectionIds;
    // A reader's troubleshooting arrives open when the feed is failing, so the reason is never hidden. An admin gets the diagnosis card instead, and Details stays shut.
    diagOpen = !session.user?.isAdmin && feed.consecutiveFailures > 0;
    displayName = feed.displayName ?? '';
    adminTitle = feed.title ?? '';
    newUrl = feed.url;
    // Arriving from the admin feed list opens the admin section.
    adminOpen = !!session.user?.isAdmin && page.url.searchParams.has('admin');
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
        ? { tone: 'error', text: 'Checked again just now, and it still isn’t working.' }
        : { tone: 'success', text: 'Checked just now. It’s working.' };
      api.event('feed_refreshed', { feedId: feed.id, via: 'feed_settings' });
    } catch (e) {
      refreshNote = { tone: 'error', text: e instanceof Error ? e.message : String(e) };
    } finally {
      refreshing = false;
    }
  }

  /** Admins only, and only while the feed is failing: what went wrong and what to do (lib/feedhealth.ts). */
  const diagnosis = $derived(feed && session.user?.isAdmin && feed.consecutiveFailures > 0 ? diagnose(feed, hostOf(feed.siteUrl ?? feed.url)) : null);
  const broken = $derived(!!feed && feed.consecutiveFailures >= BROKEN_AFTER);
  const when = (v: string | null) => (v ? new Date(v).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : null);

  /**
   * Admins see, in the diagnostics, what categories the feed sends (issue
   * #189). Fetched the first time the diagnostics open, once per feed.
   */
  let categories = $state<FeedCategories | null>(null);
  let categoriesError = $state<string | null>(null);
  let categoriesFor = -1;
  /** A busy feed's posts use hundreds of terms; the most used come first and the rest wait behind a button. */
  const TERMS_FIRST = 40;
  let allTerms = $state(false);
  $effect(() => {
    if (!diagOpen || !feed || !session.user?.isAdmin || categoriesFor === feed.id) return;
    const target = feed.id;
    categoriesFor = target;
    categories = null; categoriesError = null; allTerms = false;
    adminApi.feedCategories(target).then(
      (c) => { if (feed?.id === target) categories = c; },
      (e) => { if (feed?.id === target) categoriesError = e instanceof Error ? e.message : String(e); },
    );
  });

  $effect(() => {
    if (!session.loaded) return;
    if (!session.user) return void goto(`/login?next=${encodeURIComponent(page.url.pathname)}`, { replaceState: true });
    if (loadedId === id) return;
    loadedId = id;
    feed = null;
    refreshNote = null;
    moveNote = null;
    candidates = [];
    fetches = null; fetchesError = null; titleError = null;
    fetchesShown = 12;
    void load();
    api.event('feed_settings_view', { feedId: id });
  });
</script>

<svelte:head><title>{feed ? `Managing ${feedName(feed)}` : 'Feed settings'} · thicket</title></svelte:head>

{#snippet checkNow()}
  <div class="row">
    <Button onclick={refresh} disabled={refreshing}>{refreshing ? 'Checking…' : 'Check again now'}</Button>
    <span class="hint inline">{feed?.lastFetchedAt ? `Last checked ${longAgo(feed.lastFetchedAt)}` : 'Not checked yet'}</span>
  </div>
  {#if refreshNote}
    <Banner tone={refreshNote.tone} dismissible ondismiss={() => (refreshNote = null)}>{refreshNote.text}</Banner>
  {/if}
{/snippet}

{#if feed}
  {@const here = feed}
  <PageHeader name="Manage feed">
    {#snippet above()}<BackLink href={feedHref(here)} label={feedName(here)} />{/snippet}
    {#snippet description()}Its name, collections, and how posts show for you.{/snippet}
    {#snippet actions()}{#if ids.length > 0}<Button variant="danger" size="sm" onclick={unfollow}>Unfollow</Button>{/if}{/snippet}
  </PageHeader>
  {#if diagnosis}
    <!-- Admins, on a failing feed: what went wrong in plain words, with the fix it calls for and the way out inside the alert. -->
    <div class="diagnosis">
      <Banner tone={broken ? 'error' : 'warning'} title={diagnosis.title}>
        {diagnosis.text}
        {#snippet actions()}
          {#if diagnosis!.fix === 'address'}
            <Button size="sm" onclick={openAddress}>Change address</Button>
          {:else}
            <Button size="sm" onclick={refresh} disabled={refreshing}>{refreshing ? 'Checking…' : 'Check again now'}</Button>
          {/if}
          <Button variant="danger" link size="sm" onclick={askRemove}>Remove from thicket</Button>
        {/snippet}
      </Banner>
      {#if refreshNote && diagnosis.fix === 'wait'}
        <Banner tone={refreshNote.tone} dismissible ondismiss={() => (refreshNote = null)}>{refreshNote.text}</Banner>
      {/if}
    </div>
  {/if}
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
  {#if !session.user?.isAdmin}
    <!-- Readers: one plain sentence and the one thing they can do. Fixing a feed is an admin's job, so no raw facts here. -->
    <details class="fold" bind:open={diagOpen}>
      <summary class="tap">
        <Icon name="caret" dir={diagOpen ? 'down' : 'right'} size={16} stroke={2.4} />
        <h2>Not seeing new posts from this feed?</h2>
      </summary>
      <div class="body">
        {#if feed.consecutiveFailures > 0}
          <Banner tone="warning" title="We can’t get new posts from this feed right now">The site may have moved or changed it. We’ll keep trying.</Banner>
        {:else}
          <p class="hint">This feed is working.</p>
        {/if}
        {@render checkNow()}
      </div>
    </details>
  {:else}
    <!-- Admins: the facts and the check history, folded. What's wrong, if anything, is in the card at the top. -->
    <details class="fold" bind:open={diagOpen}>
      <summary class="tap">
        <Icon name="caret" dir={diagOpen ? 'down' : 'right'} size={16} stroke={2.4} />
        <h2>Details</h2>
      </summary>
      <div class="body">
        <Card kind="section" as="section" class="detail-card" aria-labelledby="about-h">
          <h3 class="section-title" id="about-h">About this feed</h3>
          <div>
            <SettingRow label="Feed address" value={bare(feed.url)} />
            <SettingRow label="Website" value={feed.siteUrl ? bare(feed.siteUrl) : '—'} />
            <SettingRow label="Followers" value={feed.followerCount.toLocaleString()} />
            <SettingRow label="Added" value={day(feed.createdAt)} />
            <SettingRow label="Newest post" value={feed.lastItemAt ? moment(feed.lastItemAt) : '—'} />
          </div>
          <CardFooter section>
            <span>{feed.lastFetchedAt ? `Last checked ${longAgo(feed.lastFetchedAt)}` : 'Not checked yet'}{#if feed.nextFetchAt}{` · next ${moment(feed.nextFetchAt).replace(/^Today, /, 'at ')}`}{/if}</span>
            <!-- The alert at the top carries this button when waiting is the fix; once is enough. -->
            {#snippet actions()}{#if diagnosis?.fix !== 'wait'}<Button onclick={refresh} disabled={refreshing}>{refreshing ? 'Checking…' : 'Check again now'}</Button>{/if}{/snippet}
          </CardFooter>
          {#if refreshNote && diagnosis?.fix !== 'wait'}
            <Banner tone={refreshNote.tone} dismissible ondismiss={() => (refreshNote = null)}>{refreshNote.text}</Banner>
          {/if}
        </Card>

        <Card kind="section" as="section" class="detail-card" aria-labelledby="checks-h">
          <h3 class="section-title" id="checks-h">Checks in the last {plural(fetchWindow, 'day')}</h3>
          {#if fetchesError}
            <Banner tone="error" title="Couldn’t load recent checks">{fetchesError}</Banner>
            <div><Button size="sm" onclick={loadFetches} loading={loadingFetches}>Try again</Button></div>
          {:else if fetches === null}
            <p class="hint">Loading…</p>
          {:else if fetches.length === 0}
            <p class="hint">No checks recorded.</p>
          {:else}
            <p class="section-description">{fetches.filter((f) => f.error).length} of {fetches.length === 100 ? 'the latest 100 checks' : plural(fetches.length, 'check')} failed</p>
            <ul class="list-rows checks">
              {#each shownFetches as f (f.at)}
                <li class="row-event" class:bad={!!f.error}>
                  <span class="when">{moment(f.at)}</span>
                  <span class="what">{checkLabel(f)}</span>
                  {#if f.durationMs !== null}<span class="ms">{(f.durationMs / 1000).toFixed(1)}s</span>{/if}
                </li>
              {/each}
            </ul>
            {#if fetches.length > shownFetches.length}<button class="row-more tap" onclick={() => (fetchesShown = fetches!.length)}>Show {fetches.length - shownFetches.length} more</button>{/if}
          {/if}
        </Card>

        <!-- What labels the feed and its posts carry, as stored: groundwork for filtering Explore by them (#189). -->
        <Card kind="section" as="section" class="detail-card" aria-labelledby="cats-h">
          <h3 class="section-title" id="cats-h">Categories this feed sends</h3>
          <div class="cats">
          {#if categories}
            {#if !categories.declared.length && !categories.terms.length}
              <p class="hint">None. {categories.tagged} of {plural(categories.posts, 'post')} came with categories.</p>
            {:else}
              <p class="hint">On the feed itself{categories.declared.length ? ':' : ': none'}</p>
              {#if categories.declared.length}<CategoryTerms terms={categories.declared.map((term) => ({ term }))} />{/if}
              <p class="hint">On its posts ({categories.tagged} of {plural(categories.posts, 'post')} have them){categories.terms.length ? ':' : ''}</p>
              {#if categories.terms.length}
                <CategoryTerms terms={allTerms ? categories.terms : categories.terms.slice(0, TERMS_FIRST)} />
                {#if !allTerms && categories.terms.length > TERMS_FIRST}
                  <button class="row-more tap" onclick={() => (allTerms = true)}>Show {categories.terms.length - TERMS_FIRST} more</button>
                {/if}
              {/if}
            {/if}
          {:else if categoriesError}
            <p class="hint">Couldn’t load them: {categoriesError}</p>
          {:else}
            <p class="hint" aria-live="polite">Loading…</p>
          {/if}
          </div>
        </Card>
      </div>
    </details>

    <hr />
    <!-- What an admin can change about this feed for everyone. The address is here unless the diagnosis card is already offering it. -->
    <details class="fold" bind:open={adminOpen}>
      <summary class="tap">
        <Icon name="caret" dir={adminOpen ? 'down' : 'right'} size={16} stroke={2.4} />
        <h2>Change this feed for everyone</h2>
      </summary>
      <div class="body admin">
        <Card kind="section" as="section" class="detail-card" aria-labelledby="title-h">
          <h3 class="section-title" id="title-h">Title</h3>
          <p class="section-description">What everyone sees, unless they have named the feed themselves. Leave it empty to use the feed’s own title, which comes back on its next check.</p>
          <form onsubmit={(e) => { e.preventDefault(); void saveTitle(); }}>
            <Field label="Title" hideLabel error={titleError}>
              {#snippet children({ id, describedBy, invalid })}
                <Input {id} aria-describedby={describedBy} {invalid} bind:value={adminTitle} maxlength={200} placeholder={hostOf(feed!.siteUrl ?? feed!.url)} disabled={savingTitle}>
                  {#snippet trailing()}<Button type="submit" variant="primary" disabled={!titleDirty || savingTitle}>{savingTitle ? 'Saving…' : 'Save'}</Button>{/snippet}
                </Input>
              {/snippet}
            </Field>
          </form>
        </Card>
        <Card kind="section" as="section" class="detail-card" aria-labelledby="address-h">
          <h3 class="section-title" id="address-h">Feed address</h3>
          <p class="section-description">{feed.url}</p>
          <div><Button onclick={openAddress}>Change address</Button></div>
        </Card>
        <Card kind="section" as="section" class="detail-card" aria-labelledby="remove-h">
          <h3 class="section-title" id="remove-h">Remove this feed</h3>
          <p class="section-description">Removes it and its posts for everyone. Bookmarks keep a saved copy. For spam, abuse, or feeds that don’t belong.</p>
          <div><Button variant="danger" onclick={askRemove}>Remove from thicket</Button></div>
        </Card>
      </div>
    </details>

    <Sheet title="Change this feed’s address" lede="Paste the new address or the site’s homepage. If we already have that feed, this one joins it. This can’t be undone." locked={moving} bind:dialog={addressDialog}>
      <form class="moveform" onsubmit={(e) => { e.preventDefault(); void move(newUrl); }}>
        <Field label="Feed address" hideLabel>
          {#snippet children({ id, describedBy, invalid })}
            <Input {id} aria-describedby={describedBy} {invalid} type="url" bind:element={addressInput} bind:value={newUrl} disabled={moving} autocomplete="off" autocapitalize="none" spellcheck={false} clearable={false} />
          {/snippet}
        </Field>
        {#if moveNote}
          <Banner tone={moveNote.tone}>{moveNote.text}</Banner>
        {/if}
        {#if candidates.length}
          <ul class="candidates">
            {#each candidates as c (c.url)}
              <li><Button size="sm" disabled={moving} onclick={() => { newUrl = c.url; void move(c.url); }}>{c.title ?? c.url}</Button><span class="hint inline">{c.url}</span></li>
            {/each}
          </ul>
        {/if}
      </form>
      {#snippet footer()}
        <Button variant="primary" size="lg" loading={moving} disabled={!newUrl.trim() || newUrl.trim() === feed?.url} onclick={() => move(newUrl)}>Move feed</Button>
      {/snippet}
    </Sheet>

    <Sheet title="Remove this feed for everyone?" alert locked={removing} bind:dialog={removeDialog}>
      {#if impact}
        <div class="said">
          <p>This deletes “{feed ? feedName(feed) : 'this feed'}” for everyone. That includes:</p>
          <ul>
            <li><strong>{plural(impact.posts, 'post')}</strong></li>
            <li><strong>{plural(impact.collections, 'collection')}</strong> belonging to <strong>{plural(impact.followers, 'person', 'people')}</strong></li>
            {#if impact.bookmarks}<li>links from <strong>{plural(impact.bookmarks, 'bookmark')}</strong></li>{/if}
          </ul>
          {#if impact.bookmarks}<p>Bookmarks keep their saved copy and notes.</p>{/if}
          <p>This action can’t be undone. Anyone can add the feed back later, but older posts may not come back with it.</p>
        </div>
      {:else}
        <p class="said">Counting what this would take with it…</p>
      {/if}
      {#snippet footer()}
        <Button variant="danger" solid size="lg" onclick={confirmRemove} disabled={!impact || removing}>{removing ? 'Removing…' : 'Remove for everyone'}</Button>
      {/snippet}
    </Sheet>
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
  /* The remove warning: what goes, as a list, then that it's for good. */
  .said { display: flex; flex-direction: column; gap: var(--space-2); margin: 0; color: var(--text); font-size: calc(var(--text-sm) * var(--size-app)); line-height: 1.4; }
  .said p, .said ul { margin: 0; }
  .said ul { padding-left: var(--space-5); }
  .hint.lede { margin: calc(var(--space-2) * -1) 0 var(--space-3); }
  .radios { display: flex; flex-direction: column; gap: var(--space-2); }
  .radios label { display: flex; align-items: flex-start; gap: var(--space-3); padding: var(--space-3) var(--space-4); background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-sm); cursor: pointer; }
  .radios label:has(input:checked) { border-color: var(--accent); }
  .radios input { margin-top: 3px; }
  /* 2px between a choice and its explanation is optical, not a spacing step. */
  .radios span { display: flex; flex-direction: column; gap: 2px; font-size: calc(var(--text-sm) * var(--size-app)); }
  .radios small { font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); }
  /* Each change is its own section card, stacked like the Details cards. */
  .fold .body.admin { gap: var(--space-3); }
  .moveform { display: flex; flex-direction: column; gap: var(--space-3); }
  .candidates { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-2); }
  .candidates li { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
  /* Details: three section cards, stacked. */
  /* The shared card spaces its own heading and description; what follows comes in the card's own flow. */
  .cats { display: flex; flex-direction: column; gap: var(--space-2); }
  /* The history runs to the card's edges, like the Admin lists, so its Show more row does too. */
  /* Shared list rows (row-event), run to the card's edges like the Admin lists; inside each, when, what, and how long, in columns. */
  .checks { margin: 0 calc(-1 * var(--card-pad)); border-top: 1px solid var(--line); font-variant-numeric: tabular-nums; }
  .checks li { display: flex; gap: var(--space-3); }
  .checks li.bad .what { color: var(--danger); }
  .checks .when { flex: 0 0 auto; min-width: 16ch; white-space: nowrap; }
  .checks .what { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .checks .ms { flex: 0 0 auto; }
  :global(.card.detail-card) .row-more { margin: 0 calc(-1 * var(--card-pad)) calc(-1 * var(--card-pad)); width: calc(100% + 2 * var(--card-pad)); }
  .fold summary { display: flex; align-items: center; gap: var(--space-2); cursor: pointer; list-style: none; color: var(--text-2); }
  .fold summary::-webkit-details-marker { display: none; }
  .fold summary h2 { margin: 0; font-size: calc(var(--text-base) * var(--size-app)); font-weight: 600; color: var(--text); }
  .fold .body { display: flex; flex-direction: column; gap: var(--space-3); margin-top: var(--space-3); }
  .fold .row { margin-top: 0; }
  /* The alert at the top: what's wrong, then its fix and the way out on one row under the words. */
  .diagnosis { display: flex; flex-direction: column; gap: var(--space-2); margin-bottom: var(--space-5); }
  .status { text-align: center; color: var(--text-2); padding: var(--space-5) 0; margin: 0; font-size: calc(var(--text-sm) * var(--size-app)); }
</style>
