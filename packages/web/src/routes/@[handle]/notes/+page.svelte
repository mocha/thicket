<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { api, profileHref, profilesApi, type PublicUser, type RiverItem } from '$lib/api';
  import { session } from '$lib/session.svelte';
  import NoteCard from '$lib/components/NoteCard.svelte';
  import VisitorMore from '$lib/components/VisitorMore.svelte';

  /**
   * Someone's notes as a body of work: the posts they noted, newest note
   * first, their note first under each. Readable by whoever their "Share my
   * notes" setting admits, signed-out visitors included when that is Anyone.
   * On your own page a note deleted from a card drops the card, as on My Notes.
   */
  const handle = $derived(page.params.handle ?? '');
  let owner = $state<PublicUser | null>(null);
  let isMe = $state(false);
  let items = $state<RiverItem[]>([]);
  let cursor = $state<string | null>(null);
  let done = $state(false);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let cappedAt = $state<number | null>(null);
  let sentinel = $state<HTMLElement | null>(null);
  let loadedHandle = $state<string | undefined>(undefined);

  async function loadMore(reset = false) {
    if (loading || (done && !reset)) return;
    loading = true; error = null;
    try {
      // Signed out, a limited instance sends one page and no more, so ask for all of it at once.
      const pg = await profilesApi.notes(handle, { before: reset ? null : cursor, limit: session.user ? undefined : 100 });
      owner = pg.owner; isMe = pg.isMe;
      items = reset ? pg.items : [...items, ...pg.items];
      cursor = pg.nextCursor;
      done = pg.nextCursor === null;
      cappedAt = pg.cappedAt ?? null;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      done = true;
    } finally {
      loading = false;
    }
  }

  const shown = $derived(isMe ? items.filter((i) => i.myNote) : items);
  const name = $derived(owner?.displayName ?? `@${handle}`);

  onMount(() => api.event('public_notes_view', { handle }));
  $effect(() => {
    if (loadedHandle === handle) return;
    loadedHandle = handle;
    items = []; cursor = null; done = false; cappedAt = null;
    void loadMore(true);
  });
  $effect(() => {
    if (!sentinel) return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) void loadMore(); }, { rootMargin: '800px 0px' });
    io.observe(sentinel);
    return () => io.disconnect();
  });
</script>

<svelte:head><title>Notes · @{handle} · thicket</title></svelte:head>

<nav class="crumbs"><a href={profileHref(handle)}>@{handle}</a> <span aria-hidden="true">›</span></nav>
<header class="top">
  <h1>{isMe ? 'Your notes' : `${name}’s notes`}</h1>
  <p class="sub">{#if isMe}Posts you’ve written a note on, newest note first. Who else can read them is up to your <a href="/settings">note settings</a>.{:else}Posts {name} has written a note on, newest note first.{#if !session.user} <a href="/signup?next={encodeURIComponent(page.url.pathname)}">Make an account</a> to write your own.{/if}{/if}</p>
</header>

{#if error}
  <div class="empty"><h2>Not here</h2><p>{error === 'not found' ? 'These notes aren’t shared.' : error}</p></div>
{:else if !loading && shown.length === 0}
  <div class="empty"><h2>No notes yet</h2></div>
{:else}
  <ul class="list">
    {#each shown as item (item.id)}
      <NoteCard {item} />
    {/each}
  </ul>
  {#if loading}<p class="status">Loading…</p>{/if}
  {#if cappedAt}<VisitorMore cap={cappedAt} />{:else if done && shown.length > 0}<p class="status">That’s all of them.</p>{/if}
  <div bind:this={sentinel} aria-hidden="true"></div>
{/if}

<style>
  .crumbs { font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-3); margin-bottom: 4px; }
  .crumbs a { color: var(--accent); font-weight: 600; }
  .top { margin-bottom: 14px; }
  h1 { font-family: var(--font-headings); font-size: calc(var(--text-2xl) * var(--size-headings)); margin: 0; overflow-wrap: anywhere; }
  .sub { margin: 2px 0 0; color: var(--text-3); font-size: calc(var(--text-sm) * var(--size-app)); }
  .sub a { color: var(--accent); font-weight: 600; }
  .list { display: flex; flex-direction: column; gap: 14px; margin: 0; padding: 0; }
  .empty { text-align: center; padding: 50px 20px; color: var(--text-2); }
  .empty h2 { font-family: var(--font-headings); color: var(--text); font-size: calc(var(--text-xl) * var(--size-headings)); margin: 0 0 6px; }
  .empty p { margin: 0; }
  .status { text-align: center; color: var(--text-3); font-size: calc(var(--text-sm) * var(--size-app)); padding: 18px 0; margin: 0; }
</style>
