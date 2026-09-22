<script lang="ts">
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
  import River from '$lib/components/River.svelte';
  import { showToast } from '$lib/toast.svelte';

  /**
   * A collection, mine or anyone's, at its one address. The owner reads it
   * here too (Settings is one level down), so the URL in the bar is always
   * the shareable one. The owner's two actions are named rather than hidden
   * behind a kebab: add something to this collection, or change the collection
   * itself. For visitors there is one action:
   * "Copy this collection". Signed in here, it copies at once. Signed out, a
   * sheet explains: make an account here (and come straight back), or keep
   * the link for the cross-thicket import that is still to come. The portable
   * form underneath is OPML, advertised in <head>; nobody has to know that.
   */
  const handle = $derived(page.params.handle ?? '');
  const slug = $derived(page.params.slug ?? '');
  let col = $state<PublicCollection | null>(null);
  let error = $state<string | null>(null);
  let copying = $state(false);
  let loadedKey = $state<string | undefined>(undefined);
  let showFeeds = $state(false);
  let explain = $state<HTMLDialogElement | null>(null);
  let confirmAgain = $state<HTMLDialogElement | null>(null);
  // A copy made in this visit, so the button reflects it right away. The server
  // also reports a copy from an earlier visit as col.myCopy; either counts.
  let justCopied = $state<{ slug: string; name: string } | null>(null);
  const existingCopy = $derived(justCopied ?? col?.myCopy ?? null);

  $effect(() => {
    const key = `${handle}/${slug}`;
    if (loadedKey === key) return;
    loadedKey = key;
    col = null; error = null; justCopied = null;
    profilesApi.collection(handle, slug).then((c) => { col = c; showFeeds = !c.isMe && c.feeds.length <= 8; }).catch((e) => (error = e instanceof Error ? e.message : String(e)));
  });
  onMount(() => api.event('public_collection_view', { handle, slug }));

  async function copy() {
    if (!col || copying) return;
    copying = true;
    try {
      const mine = await profilesApi.copyCollection(handle, slug);
      justCopied = { slug: mine.slug, name: mine.name };
      api.event('collection_copied', { from: `${handle}/${slug}`, collectionId: mine.id, feeds: mine.feedCount });
      void loadCollections(true);
      showToast(`Copied “${mine.name}” to your collections`, { label: 'Open', run: () => goto(collectionHref(session.user!.handle, mine.slug)) });
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    } finally {
      copying = false;
    }
  }

  const opml = $derived(profilesApi.opmlUrl(handle, slug));
  const pageUrl = $derived(page.url.href);
  async function copyLink() {
    try { await navigator.clipboard.writeText(pageUrl); showToast('Link copied'); } catch { showToast(pageUrl); }
  }
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
  <header class="top">
    <div class="titlerow">
      <h1>{col.name}</h1>
      <div class="actions">
        {#if col.isMe}
          <AddFeedButton collectionIds={[col!.id]} via="collection_page" />
          <IconButton icon="gear" variant="bordered" size="lg" href={manageCollectionHref(handle, slug)} label="Settings" title="Settings" />
        {:else if session.user}
          {#if existingCopy}
            <Button variant="primary" href={collectionHref(session.user.handle, existingCopy.slug)}>Open your copy</Button>
            <Button onclick={() => confirmAgain?.showModal()} disabled={copying}>{copying ? 'Copying…' : 'Copy again'}</Button>
          {:else}
            <Button variant="primary" onclick={copy} disabled={copying}>{copying ? 'Copying…' : 'Copy this collection'}</Button>
          {/if}
        {:else}
          <Button variant="primary" onclick={() => { api.event('copy_explainer_opened', { handle, slug }); explain?.showModal(); }}>Copy this collection</Button>
        {/if}
      </div>
    </div>
    {#if col.description}<p class="desc">{col.description}</p>{/if}
    <p class="sub">
      {#if !col.isMe}by <a href={profileHref(col.owner.handle)}>{col.owner.displayName ?? `@${col.owner.handle}`}</a> ·&nbsp;{/if}{#if col.isMe && audienceTag(col.visibility)}<Badge class="beforetext">{audienceTag(col.visibility)}</Badge>·&nbsp;{/if}<button class="reveal" onclick={() => (showFeeds = !showFeeds)} aria-expanded={showFeeds} aria-controls="collection-feeds">{col.feeds.length} {col.feeds.length === 1 ? 'feed' : 'feeds'}<Icon name="caret" size={14} stroke={2.4} dir={showFeeds ? 'down' : 'right'} /></button>
    </p>
  </header>

  <!-- Signed-out visitor pressed Copy: two ways home, neither of which mentions file formats. -->
  <dialog bind:this={explain} onclick={(e) => { if (e.target === explain) explain?.close(); }}>
    <div class="sheet">
      <h2>Take this collection with you</h2>
      <div class="ways">
        <section>
          <h3>New here?</h3>
          <p>Make an account on this thicket. You’ll land right back here, and the copy is one tap.</p>
          <Button variant="primary" href="/signup?next={encodeURIComponent(page.url.pathname)}">Create an account</Button>
          <Button href="/login?next={encodeURIComponent(page.url.pathname)}">Log in</Button>
        </section>
        <section>
          <h3>On another thicket?</h3>
          <p>Copying a collection between thickets by link is on its way. Keep this page’s link; it’s what you’ll paste.</p>
          <Button onclick={copyLink}>Copy link</Button>
        </section>
      </div>
      <IconButton class="close" icon="close" label="Close" onclick={() => explain?.close()} />
    </div>
  </dialog>

  <!-- You already have a copy: making another is fine (you might prune each
       differently), but say so first so it isn't an accident. -->
  <dialog bind:this={confirmAgain} onclick={(e) => { if (e.target === confirmAgain) confirmAgain?.close(); }}>
    <div class="sheet confirm">
      <h2>Make another copy?</h2>
      <p>You already have a copy of this collection. Copying again makes a second, separate one — handy if you want to prune each down to different feeds.</p>
      <div class="confirmbtns">
        <Button onclick={() => confirmAgain?.close()}>Cancel</Button>
        <Button variant="primary" disabled={copying} onclick={() => { confirmAgain?.close(); void copy(); }}>Copy again</Button>
      </div>
    </div>
  </dialog>

  {#if showFeeds}
    <section class="feeds" id="collection-feeds">
      <ul class="list">
        {#each col.feeds as f (f.id)}
          <li>
            <SourceIcon feedId={f.id} hasIcon={f.hasIcon} name={f.title ?? hostOf(f.url)} size={36} />
            <div class="meta">
              <a class="title" href={feedHref(f)}>{feedListName(f)}</a>
              <div class="sub2">{feedOrigin(f)}{#if f.lastItemAt} · {relativeTime(f.lastItemAt)}{/if} · {f.followerCount} {f.followerCount === 1 ? 'follower' : 'followers'}</div>
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
    </section>
  {/if}

  {#if col.isMe && col.feeds.length === 0}
    <River collection={col.id} emptyTitle="Nothing in here yet" emptyBody="Add feeds to this collection and their posts will show up here." emptyCta="Add a feed to this collection" emptyAction={() => openAddFeed({ collectionIds: [col!.id], via: 'empty_collection' })} />
  {:else}
    <River collection={col.id} emptyTitle="Nothing yet" emptyBody="No posts have come through from these feeds so far. If you just created this collection by adding some new feeds, it will take a few minutes for that content to start coming in." emptyAction={null} emptyPoll />
  {/if}
{/if}

<style>
  .top { margin-bottom: var(--space-4); }
  .titlerow { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-3); margin-bottom: var(--space-3); }
  h1 { font-family: var(--font-headings); font-size: calc(var(--text-2xl) * var(--size-headings)); margin: 0; overflow-wrap: anywhere; min-width: 0; flex: 1; }
  .desc { margin: var(--space-2) 0 0; color: var(--text-2); font-size: calc(var(--text-sm) * var(--size-app)); overflow-wrap: anywhere; }
  .sub { margin: var(--space-1) 0 0; color: var(--text-3); font-size: calc(var(--text-sm) * var(--size-app)); }
  .sub a { color: var(--accent); font-weight: 600; }
  /* The pill sits in a line of text, so it carries its own gap to the separator after it. */
  .sub :global(.beforetext) { margin-right: var(--space-2); }
  .reveal { display: inline-flex; align-items: center; gap: var(--space-1); font-size: inherit; font-weight: 600; color: var(--accent); vertical-align: baseline; }
  /* 2px of top padding is an optical nudge: the buttons sit on the title's line. */
  .actions { flex: none; display: flex; gap: var(--space-2); align-items: center; padding-top: 2px; flex-wrap: wrap; justify-content: flex-end; }
  dialog { border: 0; padding: 0; background: transparent; max-width: 100vw; max-height: 100vh; width: 100vw; height: 100vh; margin: 0; }
  dialog::backdrop { background: var(--scrim); }
  .sheet { position: fixed; left: 0; right: 0; bottom: 0; background: var(--surface); color: var(--text); border-radius: var(--radius-lg) var(--radius-lg) 0 0; padding: var(--space-5) var(--space-4) calc(var(--space-4) + var(--safe-b)); box-shadow: var(--shadow-sheet); }
  @media (min-width: 700px) { .sheet { left: 50%; right: auto; bottom: auto; top: 50%; transform: translate(-50%, -50%); width: 560px; border-radius: var(--radius-lg); } }
  .sheet h2 { font-family: var(--font-headings); font-size: calc(var(--text-xl) * var(--size-headings)); margin: 0 0 var(--space-4); }
  .ways { display: grid; gap: var(--space-3); }
  @media (min-width: 700px) { .ways { grid-template-columns: 1fr 1fr; } }
  .ways section { background: var(--bg); border-radius: var(--radius-md); padding: var(--space-4); display: flex; flex-direction: column; gap: var(--space-2); align-items: flex-start; }
  .ways h3 { margin: 0; font-size: calc(var(--text-base) * var(--size-app)); }
  .ways p { margin: 0 0 var(--space-1); font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); }
  .sheet :global(.close) { position: absolute; top: var(--space-3); right: var(--space-3); }
  @media (min-width: 700px) { .sheet.confirm { width: 460px; } }
  .confirm p { margin: 0 0 var(--space-4); color: var(--text-2); font-size: calc(var(--text-sm) * var(--size-app)); }
  .confirmbtns { display: flex; gap: var(--space-2); justify-content: flex-end; }
  .feeds { margin-bottom: var(--space-4); }
  .list { list-style: none; margin: 0; padding: 0; background: var(--surface); border-radius: var(--radius); box-shadow: var(--shadow); overflow: hidden; }
  .list li { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--space-4); border-top: 1px solid var(--line); }
  .list li:first-child { border-top: 0; }
  .children li { padding: 0; }
  .children a { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--space-4); width: 100%; }
  .children .name { flex: 1; font-weight: 600; }
  .meta { flex: 1; min-width: 0; }
  .title { display: block; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sub2 { font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .count, .chev { color: var(--text-3); font-size: calc(var(--text-sm) * var(--size-app)); }
  .chev { font-size: calc(var(--text-xl) * var(--size-app)); }
  .status { text-align: center; color: var(--text-3); padding: var(--space-6) 0; }
  .empty { text-align: center; padding: calc(var(--space-6) + var(--space-4)) var(--space-5); color: var(--text-2); }
  .empty h1 { font-size: calc(var(--text-2xl) * var(--size-app)); margin-bottom: var(--space-2); }
</style>
