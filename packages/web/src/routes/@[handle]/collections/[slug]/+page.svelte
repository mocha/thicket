<script lang="ts">
  import Dot from '$lib/components/Dot.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { api, collectionHref, feedHref, manageCollectionHref, profileHref, profilesApi, type PublicCollection } from '$lib/api';
  import { openAddFeed } from '$lib/addfeed.svelte';
  import { session } from '$lib/session.svelte';
  import { loadCollections } from '$lib/collections.svelte';
  import { feedOrigin, hostOf, relativeTime } from '$lib/time';
  import { feedListName } from '$lib/feedname';
  import { audienceTag } from '$lib/visibility';
  import SourceIcon from '$lib/components/SourceIcon.svelte';
  import FollowControl from '$lib/components/FollowControl.svelte';
  import AddFeedButton from '$lib/components/AddFeedButton.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import IconButton from '$lib/components/IconButton.svelte';
  import Button from '$lib/components/Button.svelte';
  import Badge from '$lib/components/Badge.svelte';
  import Banner from '$lib/components/Banner.svelte';
  import River from '$lib/components/River.svelte';
  import { showToast } from '$lib/toast.svelte';
  import { COPY_PARAM, copyNext, welcome } from '$lib/copyintent.svelte';

  /**
   * A collection, mine or anyone's, at its one address. The owner reads it
   * here too (Manage is one level down), so the URL in the bar is always
   * the shareable one. The owner's two actions are named rather than hidden
   * behind a kebab: add something to this collection, or change the collection
   * itself. For visitors there is one action:
   * "Copy this collection". Signed in here, it copies at once. Signed out, it
   * goes straight to Sign up, which names the collection; signing up or
   * logging in brings you back here with ?copy on the address, and the copy
   * is made the moment the page loads, no second press. The portable form
   * underneath is OPML, advertised in <head>; nobody has to know that.
   */
  const handle = $derived(page.params.handle ?? '');
  const slug = $derived(page.params.slug ?? '');
  let col = $state<PublicCollection | null>(null);
  let error = $state<string | null>(null);
  let copying = $state(false);
  let loadedKey = $state<string | undefined>(undefined);
  let showFeeds = $state(false);
  let confirmAgain = $state<HTMLDialogElement | null>(null);
  // A copy made in this visit, so the button reflects it right away. The server
  // also reports a copy from an earlier visit as col.myCopy; either counts.
  let justCopied = $state<{ slug: string; name: string } | null>(null);
  const existingCopy = $derived(justCopied ?? col?.myCopy ?? null);
  // A copy holds less than this collection when the owner has added feeds since,
  // or merged another collection into this one (issue #176). Then it isn't
  // "your copy" of what's on screen: Copy stays the main button, and a banner
  // says which collection you made from this one and how much of it it has.
  const partialCopy = $derived(!justCopied && col?.myCopy && col.myCopy.sharedFeeds < col.feeds.length ? col.myCopy : null);

  $effect(() => {
    const key = `${handle}/${slug}`;
    if (loadedKey === key) return;
    loadedKey = key;
    col = null; error = null; justCopied = null;
    profilesApi.collection(handle, slug).then((c) => { col = c; showFeeds = !c.isMe && c.feeds.length <= 8; }).catch((e) => (error = e instanceof Error ? e.message : String(e)));
  });
  onMount(() => api.event('public_collection_view', { handle, slug }));

  // Back from signing up or logging in to get this collection: copy it now,
  // then take ?copy off the address so a reload doesn't copy it again. Its
  // value says which button sent them (Copy, or the box at the end of the list).
  // The copy then takes you to your own copy of it (see copy()).
  $effect(() => {
    const from = page.url.searchParams.get(COPY_PARAM);
    if (from === null || !col || !session.user) return;
    const url = new URL(page.url);
    url.searchParams.delete(COPY_PARAM);
    void goto(url.pathname + url.search + url.hash, { replaceState: true, noScroll: true, keepFocus: true });
    // Logging in with a copy already made, or on your own collection: nothing to do.
    if (!col.isMe && !existingCopy) void copy(from || 'copy_button');
  });

  async function copy(after?: string) {
    if (!col || copying) return;
    copying = true;
    try {
      // Copied on arrival: a brand-new account's empty starter collection goes (the server checks it's untouched).
      const mine = await profilesApi.copyCollection(handle, slug, { replaceStarter: !!after });
      justCopied = { slug: mine.slug, name: mine.name };
      // `after` is set when this copy finished a sign-up or log-in, so we can count the accounts shared collections bring in.
      api.event('collection_copied', { from: `${handle}/${slug}`, collectionId: mine.id, feeds: mine.feedCount, ...(after ? { after } : {}) });
      void loadCollections(true);
      if (after) {
        // Copied on arrival: go to the copy itself, so it's what's behind the
        // welcome tour and what's left when the tour closes. The tour names it;
        // without the tour (logging in on a screen that has seen it), a note does.
        welcome.copied = mine.name;
        await goto(collectionHref(session.user!.handle, mine.slug), { replaceState: true });
        if (!welcome.open) showToast(`Copied “${mine.name}” to your collections`);
      } else {
        showToast(`Copied “${mine.name}” to your collections`, { label: 'Open', run: () => goto(collectionHref(session.user!.handle, mine.slug)) });
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    } finally {
      copying = false;
    }
  }

  const opml = $derived(profilesApi.opmlUrl(handle, slug));
</script>

<svelte:head>
  <title>{col ? `${col.name} · @${handle}` : `@${handle}`} · thicket</title>
  <link rel="alternate" type="text/x-opml" title={col?.name ?? 'Collection'} href={opml} />
</svelte:head>

{#if error}
  <div class="empty"><h1>Not here</h1><p>{error === 'not found' ? 'This collection doesn’t exist or isn’t shared.' : error}</p></div>
{:else if !col}
  <p class="status">Loading…</p>
{:else}
  {@const c = col}
  <PageHeader name={col.name} description={col.description ? colDesc : undefined}>
    {#snippet actions()}{#if session.user}
        {#if c.isMe}
          <AddFeedButton collectionIds={[c.id]} via="collection_page" />
          <Button size="sm" href={manageCollectionHref(handle, slug)}><Icon name="gear" size={16} />Manage collection</Button>
        {:else if session.user}
          {#if partialCopy}
            <Button variant="primary" onclick={() => confirmAgain?.showModal()} disabled={copying}><Icon name="copy" size={16} />{copying ? 'Copying…' : 'Copy this collection'}</Button>
          {:else if existingCopy}
            <Button variant="primary" href={collectionHref(session.user.handle, existingCopy.slug)}>Open your copy</Button>
            <Button onclick={() => confirmAgain?.showModal()} disabled={copying}><Icon name="copy" size={16} />{copying ? 'Copying…' : 'Copy again'}</Button>
          {:else}
            <Button variant="primary" onclick={() => copy()} disabled={copying}><Icon name="copy" size={16} />{copying ? 'Copying…' : 'Copy this collection'}</Button>
          {/if}
        {/if}
      {/if}{/snippet}
    {#if !col.isMe}
      <p class="sub">by <a href={profileHref(col.owner.handle)}>{col.owner.displayName ?? `@${col.owner.handle}`}</a></p>
    {:else if audienceTag(col.visibility)}
      <p class="sub"><Badge>{audienceTag(col.visibility)}</Badge></p>
    {/if}
    {#if col.isMe && col.copiedFrom}
      <p class="sub">Copied from <a href={collectionHref(col.copiedFrom.owner.handle, col.copiedFrom.slug)}>{col.copiedFrom.name}</a> by <a href={profileHref(col.copiedFrom.owner.handle)}>{col.copiedFrom.owner.displayName ?? `@${col.copiedFrom.owner.handle}`}</a></p>
    {/if}
    {#if partialCopy && session.user}
      {@const href = collectionHref(session.user.handle, partialCopy.slug)}
      {#snippet madeFrom()}You made <a class="tap" {href}>{partialCopy!.name}</a> from this collection{/snippet}
      <div class="mycopy"><Banner title={madeFrom}>It has {partialCopy.sharedFeeds} of these {col.feeds.length} feeds</Banner></div>
    {/if}
    {#if !session.user}
      <!-- The header's Sign up is the one green button on the page, and Copy
           leads there too, so Copy is just its words. -->
      <div class="visitoraction"><Button link href="/signup?next={encodeURIComponent(copyNext(handle, slug, 'copy_button'))}" onclick={() => api.event('copy_signup_started', { handle, slug, from: 'copy_button' })}><Icon name="copy" size={16} />Copy this collection</Button></div>
    {/if}
  </PageHeader>
  {#snippet colDesc()}{col?.description}{/snippet}

  <!-- You already have a copy: making another is fine (you might prune each
       differently), but say so first so it isn't an accident. -->
  <dialog bind:this={confirmAgain} onclick={(e) => { if (e.target === confirmAgain) confirmAgain?.close(); }} aria-labelledby="copy-again-title">
    <div class="sheet confirm">
      <h2 id="copy-again-title">Make another copy?</h2>
      {#if partialCopy}
        <p>You made {partialCopy.name} from this collection. It has {partialCopy.sharedFeeds} of these {col.feeds.length} feeds. Copying again makes a new, separate collection with all {col.feeds.length}.</p>
      {:else}
        <p>You already have a copy of this collection. Copying again makes a second, separate one — handy if you want to prune each down to different feeds.</p>
      {/if}
      <div class="confirmbtns">
        <Button onclick={() => confirmAgain?.close()}>Cancel</Button>
        <Button variant="primary" disabled={copying} onclick={() => { confirmAgain?.close(); void copy(); }}><Icon name="copy" size={16} />Copy again</Button>
      </div>
    </div>
  </dialog>

  <!-- The collection's feeds, in one card: a row that opens it (like the Filters row on Explore), then the list inside. On my own collection, the open card also offers the list as a file. -->
  {#if col.feeds.length > 0 || col.children.length > 0}
  <section class="feedscard">
    <div class="fc-head">
      <button class="reveal tap" onclick={() => (showFeeds = !showFeeds)} aria-expanded={showFeeds} aria-controls="collection-feeds">{showFeeds ? (col.feeds.length === 1 ? 'Hide feed' : 'Hide feeds') : col.feeds.length === 1 ? 'See the 1 feed in this collection' : `See all ${col.feeds.length} feeds in this collection`}<Icon name="caret" size={14} stroke={2.4} dir={showFeeds ? 'down' : 'right'} /></button>
      {#if col.isMe && showFeeds && col.feeds.length > 0}
        <Button size="sm" href={opml} download="{col.slug}.opml" onclick={() => api.event('opml_exported', { collectionId: col?.id })} title="Save this collection as a file other readers can open">Export feeds</Button>
      {/if}
    </div>
    {#if showFeeds}
    <div id="collection-feeds">
      <ul class="list">
        <!-- The name's link stretches over the row, so the icon and the rest of the row open the feed too, as on Explore. -->
        {#each col.feeds as f (f.id)}
          <li class="feed">
            <SourceIcon feedId={f.id} hasIcon={f.hasIcon} name={f.title ?? hostOf(f.url)} size={36} />
            <div class="meta">
              <a class="title whole" href={feedHref(f)}>{feedListName(f)}</a>
              <div class="sub2">{feedOrigin(f)}{#if f.lastItemAt} <Dot /> {relativeTime(f.lastItemAt)}{/if} <Dot /> {f.followerCount} {f.followerCount === 1 ? 'follower' : 'followers'}{#if f.failing} <Dot /> <span class="bad">failing</span>{/if}</div>
            </div>
            {#if session.user}
              <FollowControl feedId={f.id} ids={f.myCollectionIds} name={f.title ?? hostOf(f.url)} compact />
            {/if}
          </li>
        {/each}
      </ul>
      {#if col.children.length}
        <ul class="list children">
          {#each col.children as c (c.id)}
            <li><a href={collectionHref(handle, c.slug)}><span class="name">{c.name}</span><span class="count">{c.feedCount} feeds</span><span class="chev">›</span></a></li>
          {/each}
        </ul>
      {/if}
    </div>
    {/if}
  </section>
  {/if}

  {#if col.isMe && col.feeds.length === 0}
    <River collection={col.id} emptyTitle="Nothing in here yet" emptyBody="Add feeds to this collection and their posts will show up here." emptyCta="Add a feed to this collection" emptyAction={() => openAddFeed({ collectionIds: [col!.id], via: 'empty_collection' })} />
  {:else}
    <River collection={col.id} emptyTitle="Nothing yet" emptyBody="No posts have come through from these feeds so far. If you just created this collection by adding some new feeds, it will take a few minutes for that content to start coming in." emptyAction={null} emptyPoll />
  {/if}
{/if}

<style>
  .sub { margin: var(--space-1) 0 0; color: var(--text-2); font-size: calc(var(--text-sm) * var(--size-app)); }
  .sub a { color: var(--accent); font-weight: 600; }
  .mycopy { margin-top: var(--space-4); }
  /* The pill sits in a line of text, so it carries its own gap to the separator after it. */
  .feedscard { background: var(--surface); border-radius: var(--radius); box-shadow: var(--shadow); overflow: hidden; margin-bottom: var(--space-4); }
  /* The row that opens the card. As tall open as closed, so the Export button arriving doesn't move anything. */
  .fc-head { display: flex; align-items: center; gap: var(--space-3); min-height: 52px; padding: var(--space-2) var(--space-4); }
  /* The whole strip to the left of Export opens and closes the list, not just the words. */
  .reveal { flex: 1; min-width: 0; display: flex; align-items: center; gap: var(--space-1); text-align: left; font-size: calc(var(--text-sm) * var(--size-app)); font-weight: 600; color: var(--accent); }
  /* Inside the card the lists are part of it, not cards of their own. */
  .feedscard .list { background: none; box-shadow: none; border-radius: 0; border-top: 1px solid var(--line); }
  /* 2px of top padding is an optical nudge: the buttons sit on the title's line. */
  /* The link keeps its own padding; pull it back so its words start at the title's left edge. */
  .visitoraction { margin: var(--space-2) 0 0 calc(-1 * var(--space-2)); }
  dialog { border: 0; padding: 0; background: transparent; max-width: 100vw; max-height: 100vh; width: 100vw; height: 100vh; margin: 0; }
  dialog::backdrop { background: var(--scrim); }
  .sheet { position: fixed; left: 0; right: 0; bottom: 0; background: var(--surface); color: var(--text); border-radius: var(--radius-lg) var(--radius-lg) 0 0; padding: var(--space-5) var(--space-4) calc(var(--space-4) + var(--safe-b)); box-shadow: var(--shadow-sheet); }
  @media (min-width: 700px) { .sheet { left: 50%; right: auto; bottom: auto; top: 50%; transform: translate(-50%, -50%); width: 560px; border-radius: var(--radius-lg); } }
  .sheet h2 { font-family: var(--font-headings); font-size: calc(var(--text-xl) * var(--size-headings)); margin: 0 0 var(--space-4); }
  @media (min-width: 700px) { .sheet.confirm { width: 460px; } }
  .confirm p { margin: 0 0 var(--space-4); color: var(--text-2); font-size: calc(var(--text-sm) * var(--size-app)); }
  .confirmbtns { display: flex; gap: var(--space-2); justify-content: flex-end; }
  .bad { color: var(--danger); }
  .list { list-style: none; margin: 0; padding: 0; background: var(--surface); border-radius: var(--radius); box-shadow: var(--shadow); overflow: hidden; }
  .list li { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--space-4); border-top: 1px solid var(--line); }
  .list li:first-child { border-top: 0; }
  .children li { padding: 0; }
  .children a { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--space-4); width: 100%; }
  .children .name { flex: 1; font-weight: 600; }
  .meta { flex: 1; min-width: 0; }
  .title { display: block; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .list li.feed { position: relative; }
  .whole::after { content: ''; position: absolute; inset: 0; }
  li.feed :global(.follow) { position: relative; z-index: 1; }
  @media (hover: hover) { li.feed:hover .title { text-decoration: underline; text-underline-offset: 3px; } }
  .sub2 { font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .count { color: var(--text-2); font-size: calc(var(--text-sm) * var(--size-app)); }
  .chev { color: var(--text-3); font-size: calc(var(--text-xl) * var(--size-app)); }
  .status { text-align: center; color: var(--text-2); padding: var(--space-6) 0; }
  .empty { text-align: center; padding: calc(var(--space-6) + var(--space-4)) var(--space-5); color: var(--text-2); }
  .empty h1 { font-family: var(--font-headings); font-size: calc(var(--text-2xl) * var(--size-app)); margin: 0 0 var(--space-2); }
</style>
