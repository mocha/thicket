<script lang="ts">
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
  import { page } from '$app/state';
  import { replaceState } from '$app/navigation';
  import { api, feedHref, itemHref, itemsApi, type Note, type RiverItem } from '$lib/api';
  import { hostOf, relativeTime } from '$lib/time';
  import { openReaderHere, readsInline } from '$lib/reader.svelte';
  import { session } from '$lib/session.svelte';
  import { showToast } from '$lib/toast.svelte';
  import SourceIcon from '$lib/components/SourceIcon.svelte';
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
  const href = $derived(item?.url ?? item?.siteUrl ?? '#');
  const backHref = $derived(item ? feedHref({ id: item.feedId, slug: item.feedSlug }) : '/');
  const isVideo = $derived(/(^|\.)(youtube\.com|youtu\.be|vimeo\.com)$/.test(hostOf(href)));

  async function load() {
    try {
      const got = await itemsApi.get(itemId);
      if (loadedId !== itemId) return;
      item = got;
      myNote = got.myNote ?? null;
      // The ids resolve; the slugs are for people. Correct them in place either way.
      if (readsInline()) openReaderHere(got);
      else if (page.url.pathname !== itemHref(got)) replaceState(itemHref(got) + page.url.search, page.state);
    } catch (e) {
      if (loadedId === itemId) error = e instanceof Error ? e.message : String(e);
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
</script>

{#if item}
  <nav class="crumbs"><a href={backHref}>{source}</a> <span aria-hidden="true">›</span></nav>

  <article class="post">
    <header>
      <a class="who" href={backHref}>
        <SourceIcon feedId={item.feedId} hasIcon={item.hasIcon} name={source} />
        <span class="name">{source}</span>
      </a>
      <span class="dot">·</span>
      <time datetime={item.publishedAt} title={new Date(item.publishedAt).toLocaleString()}>{relativeTime(item.publishedAt)}</time>
      <span class="spacer"></span>
      {#if session.user}<ItemActions {item} noteOpen={editing} onnote={noteButton} via="post" />{/if}
    </header>

    <h1>{item.title ?? item.summary ?? item.url}</h1>
    <p class="byline">
      {#if item.author}<span>{item.author}</span><span class="dot">·</span>{/if}
      <time datetime={item.publishedAt}>{new Date(item.publishedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}</time>
    </p>

    {#if item.imageUrl && !imgFailed}
      <img class="hero" src={item.imageUrl} alt="" referrerpolicy="no-referrer" onerror={() => (imgFailed = true)} />
    {/if}

    {#if item.summary && item.summary !== item.title}<p class="summary">{item.summary}</p>{/if}

    <footer>
      <ReadOnSiteLink {href} label={isVideo ? 'Watch on ' + hostOf(href).replace(/^www\./, '') : undefined} onclick={outbound} />
      {#if !session.user}
        <p class="note">Posts are read here by people with an account on this instance. <a href="/login">Sign in</a> to read it without leaving, or follow {source} to get what they publish next.</p>
      {/if}
    </footer>

    {#if session.user}
      {#if editing}
        <NoteEditor itemId={item.id} note={myNote}
          onsaved={(n) => { showToast(myNote ? 'Note updated' : 'Note saved'); myNote = n; if (item) item.myNote = n; editing = false; }}
          ondeleted={() => { myNote = null; if (item) item.myNote = null; editing = false; }}
          oncancel={() => (editing = false)} />
      {:else if myNote}
        <NoteBlock note={myNote} mine onedit={() => (editing = true)} />
      {/if}
    {/if}
    {#each others as n (n.id)}<NoteBlock note={n} />{/each}
  </article>
{:else if error}
  <p class="empty">This post isn’t here. It may have been pruned, or the address may be wrong. <a href={backHref}>Go to the feed</a></p>
{:else}
  <p class="empty" aria-live="polite">Loading…</p>
{/if}

<style>
  .crumbs { font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-3); margin: 0 0 var(--space-3); }
  .crumbs a { color: var(--text-2); }
  .crumbs a:hover { color: var(--text); }

  .post { max-width: 680px; }
  header { display: flex; align-items: center; gap: var(--space-2); font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); min-width: 0; }
  .who { display: flex; align-items: center; gap: var(--space-2); min-width: 0; color: inherit; }
  .name { font-weight: 600; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .dot { color: var(--text-3); }
  header time { color: var(--text-3); white-space: nowrap; }
  .spacer { flex: 1; }

  h1 { margin: var(--space-4) 0 0; font-family: var(--font-headings); font-weight: 600; font-size: calc(var(--text-2xl) * var(--size-headings)); line-height: 1.2; letter-spacing: -0.012em; overflow-wrap: anywhere; text-wrap: balance; }
  .byline { margin: var(--space-3) 0 0; font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-3); display: flex; gap: var(--space-2); flex-wrap: wrap; }
  .hero { width: 100%; border-radius: var(--radius-sm); margin-top: var(--space-4); background: var(--surface-2); }
  .summary { font-family: var(--font-reading); font-size: calc(var(--text-reading) * var(--size-reading)); line-height: 1.6; color: var(--text-2); margin: var(--space-4) 0 0; }

  footer { margin-top: var(--space-6); padding-top: var(--space-4); border-top: 1px solid var(--line); display: flex; flex-direction: column; align-items: flex-start; gap: var(--space-4); }
  .note { margin: 0; font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); line-height: 1.5; }
  .note a { color: var(--accent); }

  .empty { color: var(--text-3); font-size: calc(var(--text-base) * var(--size-app)); }
  .empty a { color: var(--accent); }
</style>
