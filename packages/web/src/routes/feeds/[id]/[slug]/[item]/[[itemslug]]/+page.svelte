<script lang="ts">
  import Dot from '$lib/components/Dot.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import BackLink from '$lib/components/BackLink.svelte';
  /**
   * A post at its own address: /feeds/:id/:slug/:item/:itemslug.
   *
   * This is what the reader's address bar shows, so it is also what gets
   * pasted to somebody. For a member who reads here, the reader opens over
   * this page and closing it lands on the feed — the same place closing would
   * land if they had opened the post from the feed in the first place.
   *
   * Everyone else — signed out, on another instance, or reading in tabs by
   * choice — gets the post's card and the way to the original. The publisher's
   * text is not shown to the open web; what the post is, is. So a link you
   * send never dead-ends, and it says what it is before anyone signs in.
   */
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { replaceState } from '$app/navigation';
  import { api, feedHref, itemHref, itemsApi, type Note, type RiverItem } from '$lib/api';
  import { noteToast } from '$lib/saves';
  import { hostOf, webHref } from '$lib/time';
  import { openReaderHere, readsInline } from '$lib/reader.svelte';
  import { session } from '$lib/session.svelte';
  import { site, loadSite } from '$lib/site.svelte';
  import { showToast } from '$lib/toast.svelte';
  import ItemActions from '$lib/components/ItemActions.svelte';
  import NoteEditor from '$lib/components/NoteEditor.svelte';
  import NoteBlock from '$lib/components/NoteBlock.svelte';
  import ReadOnSiteLink from '$lib/components/ReadOnSiteLink.svelte';

  const itemId = $derived(Number(page.params.item));
  let item = $state<RiverItem | null>(null);
  let error = $state<string | null>(null);
  let loadedId = $state<number | undefined>(undefined);
  let imgFailed = $state(false);
  let myNote = $state<Note | null>(null);
  let editing = $state(false);
  const others = $derived(item?.notes ?? []);

  const source = $derived(item ? (item.feedTitle ?? hostOf(item.siteUrl ?? item.url)) : '');
  const href = $derived(webHref(item?.url) ?? webHref(item?.siteUrl) ?? '#');
  const backHref = $derived(item ? feedHref({ id: item.feedId, slug: item.feedSlug }) : '/new-posts');
  const isVideo = $derived(/(^|\.)(youtube\.com|youtu\.be|vimeo\.com)$/.test(hostOf(href)));

  async function load() {
    // Capture the id we're fetching: itemId is reactive and moves on when the
    // reader navigates, so comparing loadedId to itemId after the await always
    // matched. Compare against this snapshot to drop a stale, out-of-order response.
    const reqId = itemId;
    try {
      const got = await itemsApi.get(reqId);
      if (reqId !== itemId) return;
      item = got;
      myNote = got.myNote ?? null;
      // The ids resolve; the slugs are for people. Correct them in place either way.
      if (readsInline()) openReaderHere(got);
      else if (page.url.pathname !== itemHref(got)) replaceState(itemHref(got) + page.url.search, page.state);
    } catch (e) {
      if (reqId === itemId) error = e instanceof Error ? e.message : String(e);
    }
  }

  $effect(() => {
    if (!Number.isInteger(itemId) || loadedId === itemId) return;
    loadedId = itemId;
    item = null;
    error = null;
    imgFailed = false;
    myNote = null;
    editing = false;
    void load();
  });

  /** Name the tab after the post, so a browser bookmark of this address says what it is. */
  $effect(() => {
    if (!item) return;
    const was = document.title;
    document.title = item.title ? `${item.title} · thicket` : was;
    return () => { document.title = was; };
  });

  function outbound() {
    if (item) api.event('item_opened', { itemId: item.id, feedId: item.feedId, via: 'post' });
  }

  function noteButton() {
    editing = !editing;
    if (editing && item) api.event('note_editor_opened', { itemId: item.id, existing: !!myNote, via: 'post' });
  }
  // Signed out, the footer note names the site.
  onMount(() => { if (!session.user) void loadSite(); });
</script>

{#if item}
  <article class="post">
    <PageHeader name={item.title ?? item.summary ?? item.url ?? undefined} line={false} actions={session.user ? postActions : undefined}>
      {#snippet above()}<BackLink href={backHref} label={source} />{/snippet}
      {#snippet description()}
        <span class="byline">
          {#if item!.author}<span>{item!.author}</span><Dot />{/if}
          <time datetime={item!.publishedAt}>{new Date(item!.publishedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}</time>
        </span>
      {/snippet}
    </PageHeader>
    {#snippet postActions()}<ItemActions item={item!} noteOpen={editing} onnote={noteButton} via="post" />{/snippet}

    {#if item.imageUrl && !imgFailed}
      <img class="hero" src={item.imageUrl} alt="" referrerpolicy="no-referrer" onerror={() => (imgFailed = true)} />
    {/if}

    {#if item.summary && item.summary !== item.title}<p class="summary">{item.summary}</p>{/if}

    <footer>
      <ReadOnSiteLink {href} label={isVideo ? 'Watch on ' + hostOf(href).replace(/^www\./, '') : undefined} onclick={outbound} />
      {#if !session.user}
        <p class="note">People with an account on {site.status?.name ?? 'this site'} can read posts right here. <a href="/login">Log in</a> to read this one without leaving, or follow {source} to get what they publish next.</p>
      {/if}
    </footer>

    <!-- The notes sit on the page here, not in a card, so they line up with the post's text. -->
    <div class="notes">
    {#if session.user}
      {#if editing}
        <NoteEditor itemId={item.id} note={myNote}
          onsaved={(n) => { if (item) { showToast(noteToast(item)); item.myNote = n; item.bookmarkId = n.bookmarkId; } myNote = n; editing = false; }}
          ondeleted={() => { myNote = null; if (item) item.myNote = null; editing = false; }}
          oncancel={() => (editing = false)} />
      {:else if myNote}
        <NoteBlock note={myNote} mine onedit={() => (editing = true)} />
      {/if}
    {/if}
    {#each others as n (n.id)}<NoteBlock note={n} />{/each}
    </div>
  </article>
{:else if error}
  <p class="empty">This post isn’t here. It may have been pruned, or the address may be wrong. <a href={backHref}>Go to the feed</a></p>
{:else}
  <p class="empty" aria-live="polite">Loading…</p>
{/if}

<style>
  .post { max-width: 680px; }
  .notes { margin-top: var(--space-4); }
  /* No card here, so the note and its editor run the page's width. */
  .notes :global(.note), .notes :global(.editor) { margin-left: 0; margin-right: 0; }

  .byline { display: flex; gap: var(--space-2); flex-wrap: wrap; }
  .hero { width: 100%; border-radius: var(--radius-sm); margin-top: 0; background: var(--surface-2); }
  .summary { font-family: var(--font-reading); font-size: calc(var(--text-reading) * var(--size-reading)); line-height: 1.6; color: var(--text-2); margin: 0; overflow-wrap: anywhere; }

  footer { margin-top: var(--space-6); padding-top: var(--space-4); border-top: 1px solid var(--line); display: flex; flex-direction: column; align-items: flex-start; gap: var(--space-4); }
  .note { margin: 0; font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); line-height: 1.5; }
  .note a { color: var(--accent); }

  .empty { color: var(--text-2); font-size: calc(var(--text-base) * var(--size-app)); }
  .empty a { color: var(--accent); }
</style>
