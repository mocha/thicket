<script lang="ts">
  import { onMount } from 'svelte';
  import { api, notesApi, type RiverItem } from '$lib/api';
  import NoteCard from '$lib/components/NoteCard.svelte';
  import Button from '$lib/components/Button.svelte';

  /**
   * My Notes: every post I have left a note on, newest note first, shown as
   * the same cards as everywhere else with my note under each. Reading back
   * what I thought when I read the thing.
   */
  let items = $state<RiverItem[]>([]);
  let cursor = $state<string | null>(null);
  let done = $state(false);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let sentinel = $state<HTMLElement | null>(null);

  async function loadMore(reset = false) {
    if (loading || (done && !reset)) return;
    loading = true; error = null;
    try {
      const pg = await notesApi.list({ before: reset ? null : cursor, limit: 30 });
      // A note deleted from a card here should drop the card; filter on the way in and after edits.
      items = reset ? pg.items : [...items, ...pg.items];
      cursor = pg.nextCursor;
      done = pg.nextCursor === null;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  const shown = $derived(items.filter((i) => i.myNote));

  onMount(() => { api.event('notes_view'); void loadMore(true); });
  $effect(() => {
    if (!sentinel) return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) void loadMore(); }, { rootMargin: '800px 0px' });
    io.observe(sentinel);
    return () => io.disconnect();
  });
</script>

<svelte:head><title>My Notes · thicket</title></svelte:head>

<header class="top">
  <h1>My Notes</h1>
  <p class="sub">Posts you’ve written a note on, newest note first.</p>
</header>

{#if error}
  <p class="status error">Couldn’t load notes: {error}</p>
{:else if !loading && shown.length === 0}
  <div class="empty">
    <!-- A post card with the note corner lit up: the thing to press. -->
    <svg class="illo" viewBox="0 0 260 120" width="260" height="120" aria-hidden="true">
      <rect x="8" y="10" width="244" height="100" rx="14" fill="var(--surface)" stroke="var(--line)" />
      <circle cx="34" cy="34" r="9" fill="var(--surface-2)" />
      <rect x="50" y="29" width="70" height="10" rx="5" fill="var(--surface-2)" />
      <rect x="24" y="56" width="200" height="12" rx="6" fill="var(--line)" />
      <rect x="24" y="76" width="150" height="12" rx="6" fill="var(--line)" />
      <circle cx="190" cy="36" r="20" fill="color-mix(in srgb, var(--accent) 18%, transparent)" />
      <circle cx="190" cy="36" r="20" fill="none" stroke="var(--accent)" stroke-width="2" stroke-dasharray="4 4" />
      <path d="M181 29.5a1.5 1.5 0 0 1 1.5-1.5h15a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H188l-5 4v-4h-.5a1.5 1.5 0 0 1-1.5-1.5z" fill="var(--accent)" />
      <path d="M222 28h9v16l-4.5-3-4.5 3z" fill="none" stroke="var(--text-3)" stroke-width="1.6" />
    </svg>
    <h2>No notes yet</h2>
    <p>Every post has a note icon next to its bookmark. Press it, write what you thought, and it stays with the post: in All my feeds, in any collection it appears in, and here. Markdown works. One note per post, edit it any time. Depending on your settings, people who follow you can read your notes and you can read theirs.</p>
    <div class="ctas"><Button variant="primary" size="lg" href="/">Go to All my feeds</Button><Button size="lg" href="/settings">Note settings</Button></div>
  </div>
{:else}
  <ul class="list">
    {#each shown as item (item.id)}
      <NoteCard {item} />
    {/each}
  </ul>
  {#if loading}<p class="status">Loading…</p>{/if}
  {#if done && shown.length > 0}<p class="status">That’s all of them.</p>{/if}
  <div bind:this={sentinel} aria-hidden="true"></div>
{/if}

<style>
  .top { margin-bottom: var(--space-4); }
  h1 { font-family: var(--font-headings); font-size: calc(var(--text-2xl) * var(--size-headings)); margin: 0; }
  /* 2px is an optical nudge under the title, not a spacing step. */
  .sub { margin: 2px 0 0; color: var(--text-3); font-size: calc(var(--text-sm) * var(--size-app)); }
  .list { display: flex; flex-direction: column; gap: var(--space-3); margin: 0; padding: 0; }
  .status { text-align: center; color: var(--text-3); font-size: calc(var(--text-sm) * var(--size-app)); padding: var(--space-4) 0; margin: 0; }
  .status.error { color: var(--danger); }
  .empty { text-align: center; padding: calc(var(--space-6) + var(--space-2)) var(--space-5); color: var(--text-2); }
  .empty h2 { font-family: var(--font-headings); color: var(--text); font-size: calc(var(--text-xl) * var(--size-headings)); margin: 0 0 var(--space-2); }
  .empty p { margin: 0 auto; max-width: 460px; font-size: calc(var(--text-base) * var(--size-app)); }
  .illo { display: block; margin: 0 auto var(--space-4); max-width: 100%; }
  .ctas { display: flex; gap: var(--space-2); justify-content: center; flex-wrap: wrap; margin-top: var(--space-4); }
</style>
