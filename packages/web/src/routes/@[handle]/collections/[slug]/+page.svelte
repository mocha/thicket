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
  import FollowButton from '$lib/components/FollowButton.svelte';
  import AddFeedButton from '$lib/components/AddFeedButton.svelte';
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

  $effect(() => {
    const key = `${handle}/${slug}`;
    if (loadedKey === key) return;
    loadedKey = key;
    col = null; error = null;
    profilesApi.collection(handle, slug).then((c) => { col = c; showFeeds = !c.isMe && c.feeds.length <= 8; }).catch((e) => (error = e instanceof Error ? e.message : String(e)));
  });
  onMount(() => api.event('public_collection_view', { handle, slug }));

  async function copy() {
    if (!col || copying) return;
    copying = true;
    try {
      const mine = await profilesApi.copyCollection(handle, slug);
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
          <a class="btn icon" href={manageCollectionHref(handle, slug)} aria-label="Settings" title="Settings"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg></a>
        {:else if session.user}
          <button class="btn primary" onclick={copy} disabled={copying}>{copying ? 'Copying…' : 'Copy this collection'}</button>
        {:else}
          <button class="btn primary" onclick={() => { api.event('copy_explainer_opened', { handle, slug }); explain?.showModal(); }}>Copy this collection</button>
        {/if}
      </div>
    </div>
    {#if col.description}<p class="desc">{col.description}</p>{/if}
    <p class="sub">
      {#if !col.isMe}by <a href={profileHref(col.owner.handle)}>{col.owner.displayName ?? `@${col.owner.handle}`}</a> ·&nbsp;{/if}{#if col.isMe && audienceTag(col.visibility)}<span class="tag">{audienceTag(col.visibility)}</span> ·&nbsp;{/if}<button class="reveal" onclick={() => (showFeeds = !showFeeds)} aria-expanded={showFeeds} aria-controls="collection-feeds">{col.feeds.length} {col.feeds.length === 1 ? 'feed' : 'feeds'}<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style:transform={showFeeds ? 'rotate(90deg)' : 'none'}><path d="M9 6l6 6-6 6" /></svg></button>
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
          <a class="btn primary" href="/signup?next={encodeURIComponent(page.url.pathname)}">Create an account</a>
          <a class="btn" href="/login?next={encodeURIComponent(page.url.pathname)}">Log in</a>
        </section>
        <section>
          <h3>On another thicket?</h3>
          <p>Copying a collection between thickets by link is on its way. Keep this page’s link; it’s what you’ll paste.</p>
          <button class="btn" onclick={copyLink}>Copy link</button>
        </section>
      </div>
      <button class="close" onclick={() => explain?.close()} aria-label="Close">×</button>
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
              <FollowButton feedId={f.id} ids={f.myCollectionIds} name={f.title ?? hostOf(f.url)} compact />
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
    <River collection={col.id} emptyTitle="Nothing yet" emptyBody="No posts have come through from these feeds so far." emptyAction={null} />
  {/if}
{/if}

<style>
  .top { margin-bottom: 16px; }
  .titlerow { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
  h1 { font-family: var(--font-headings); font-size: calc(28px * var(--size-headings)); margin: 0; overflow-wrap: anywhere; min-width: 0; flex: 1; }
  .desc { margin: 6px 0 0; color: var(--text-2); font-size: calc(14px * var(--size-app)); overflow-wrap: anywhere; }
  .sub { margin: 4px 0 0; color: var(--text-3); font-size: calc(14px * var(--size-app)); }
  .sub a { color: var(--accent); font-weight: 600; }
  .reveal { display: inline-flex; align-items: center; gap: 3px; font-size: inherit; font-weight: 600; color: var(--accent); vertical-align: baseline; }
  .reveal svg { transition: transform 150ms ease; }
  .tag { font-size: calc(11px * var(--size-app)); font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; border: 1px solid var(--line); border-radius: 999px; padding: 1px 7px; }
  .actions { flex: none; display: flex; gap: 8px; align-items: center; padding-top: 2px; flex-wrap: wrap; justify-content: flex-end; }
  .btn { padding: 9px 14px; border-radius: 999px; border: 1px solid var(--line); background: var(--surface); font-size: calc(14px * var(--size-app)); font-weight: 600; color: var(--text-2); white-space: nowrap; }
  .btn:hover { background: var(--surface-2); color: var(--text); }
  .btn.icon { display: inline-flex; align-items: center; justify-content: center; padding: 9px; }
  .btn.primary { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
  .btn:disabled { opacity: 0.6; }
  dialog { border: 0; padding: 0; background: transparent; max-width: 100vw; max-height: 100vh; width: 100vw; height: 100vh; margin: 0; }
  dialog::backdrop { background: rgba(0, 0, 0, 0.45); }
  .sheet { position: fixed; left: 0; right: 0; bottom: 0; background: var(--surface); color: var(--text); border-radius: 20px 20px 0 0; padding: 20px 18px calc(18px + var(--safe-b)); box-shadow: 0 -10px 40px rgba(0,0,0,0.25); }
  @media (min-width: 700px) { .sheet { left: 50%; right: auto; bottom: auto; top: 50%; transform: translate(-50%, -50%); width: 560px; border-radius: 20px; } }
  .sheet h2 { font-family: var(--font-headings); font-size: calc(22px * var(--size-headings)); margin: 0 0 14px; }
  .ways { display: grid; gap: 12px; }
  @media (min-width: 700px) { .ways { grid-template-columns: 1fr 1fr; } }
  .ways section { background: var(--bg); border-radius: 14px; padding: 14px; display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
  .ways h3 { margin: 0; font-size: calc(15px * var(--size-app)); }
  .ways p { margin: 0 0 4px; font-size: calc(14px * var(--size-app)); color: var(--text-2); }
  .close { position: absolute; top: 10px; right: 10px; width: 32px; height: 32px; border-radius: 50%; font-size: calc(22px * var(--size-app)); color: var(--text-3); }
  .feeds { margin-bottom: 18px; }
  .list { list-style: none; margin: 0; padding: 0; background: var(--surface); border-radius: var(--radius); box-shadow: var(--shadow); overflow: hidden; }
  .list li { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-top: 1px solid var(--line); }
  .list li:first-child { border-top: 0; }
  .children li { padding: 0; }
  .children a { display: flex; align-items: center; gap: 12px; padding: 14px 16px; width: 100%; }
  .children .name { flex: 1; font-weight: 600; }
  .meta { flex: 1; min-width: 0; }
  .title { display: block; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sub2 { font-size: calc(13px * var(--size-app)); color: var(--text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .count, .chev { color: var(--text-3); font-size: calc(13px * var(--size-app)); }
  .chev { font-size: calc(20px * var(--size-app)); }
  .status { text-align: center; color: var(--text-3); padding: 30px 0; }
  .empty { text-align: center; padding: 50px 20px; color: var(--text-2); }
  .empty h1 { font-size: calc(24px * var(--size-app)); margin-bottom: 6px; }
</style>
