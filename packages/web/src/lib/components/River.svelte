<script lang="ts">
  /**
   * The stream. Newest first, infinite scroll, keyset paginated. Scoped by
   * nothing (Everything), a collection subtree, or a single feed. The page
   * around it owns the title; this owns the list, cut into calendar days with
   * a heading that sticks to the top while that day's posts scroll under it.
   * Today's heading is "Latest posts"; dates start the day before.
   */
  import { api, type RiverItem } from '$lib/api';
  import ItemCard from './ItemCard.svelte';
  import { openAddFeed } from '$lib/addfeed.svelte';
  import { dayKey, dayLabel } from '$lib/time';
  import { session } from '$lib/session.svelte';
  import VisitorMore from './VisitorMore.svelte';

  let { collection = null, feed = null, showSource = true, emptyTitle = 'Nothing here yet', emptyBody = 'thicket shows the posts of sites you follow, newest first, with nothing in between. Add a site by its address and its posts start arriving here, or look through Explore to see what other people here read.', emptyHref = null, emptyCta = 'Add a feed', emptyAction = () => openAddFeed({ via: 'empty_river' }) }: {
    collection?: number | null; feed?: number | null; showSource?: boolean;
    emptyTitle?: string; emptyBody?: string; emptyHref?: string | null; emptyCta?: string;
    /** null = no call to action. Default opens the Add sheet. */
    emptyAction?: (() => void) | null;
  } = $props();

  let items = $state<RiverItem[]>([]);
  let cursor = $state<string | null>(null);
  let done = $state(false);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let hidden = $state(0);
  /** Set when a visitor without an account has had all the instance lets visitors see; the number is that limit. */
  let cappedAt = $state<number | null>(null);
  let sentinel = $state<HTMLElement | null>(null);
  let loadedKey = $state<string | undefined>(undefined);

  type Group = { key: string; label: string; items: RiverItem[] };
  const groups = $derived.by<Group[]>(() => {
    const today = dayKey(new Date());
    const out: Group[] = [];
    for (const item of items) {
      let key = dayKey(new Date(item.publishedAt));
      if (key > today) key = today; // future-dated posts ride along with today's
      const last = out[out.length - 1];
      if (last && last.key === key) last.items.push(item);
      else out.push({ key, label: dayLabel(key), items: [item] });
    }
    return out;
  });

  async function loadMore(reset = false) {
    if (loading || (done && !reset)) return;
    loading = true;
    error = null;
    try {
      // Signed out, a limited instance sends one page and no more, so ask for all of it at once.
      const pg = await api.river({ before: reset ? null : cursor, collection, feed, limit: session.user ? 30 : 100 });
      items = reset ? pg.items : [...items, ...pg.items];
      cursor = pg.nextCursor;
      done = pg.nextCursor === null;
      hidden = reset ? pg.hidden : hidden + pg.hidden;
      cappedAt = pg.cappedAt ?? null;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  export function reload() {
    items = []; cursor = null; done = false; hidden = 0; cappedAt = null;
    return loadMore(true);
  }

  $effect(() => {
    const key = `${collection}|${feed}`;
    if (loadedKey === key) return;
    loadedKey = key;
    void reload();
  });

  $effect(() => {
    if (!sentinel) return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) void loadMore(); }, { rootMargin: '1200px 0px' });
    io.observe(sentinel);
    return () => io.disconnect();
  });
</script>

<section class="river" aria-live="polite">
  {#each groups as g (g.key)}
    <section class="day">
      <h2 class="dayhead">{g.label}</h2>
      {#each g.items as item (item.id)}
        <ItemCard {item} {showSource} />
      {/each}
    </section>
  {/each}

  {#if !loading && items.length === 0 && !error}
    <div class="empty">
      <h2>{emptyTitle}</h2>
      <p>{emptyBody}</p>
      <div class="ctas">
        {#if emptyHref}<a class="cta" href={emptyHref}>{emptyCta}</a>{:else if emptyAction}<button type="button" class="cta" onclick={emptyAction}>{emptyCta}</button>{/if}
        {#if collection === null && feed === null}<a class="cta ghost" href="/explore">Explore feeds</a>{/if}
      </div>
    </div>
  {/if}
  {#if error}<p class="status error">Couldn’t load posts: {error}</p>{/if}
  {#if loading}<p class="status">Loading…</p>{/if}
  {#if cappedAt}<VisitorMore cap={cappedAt} />{:else if done && items.length > 0}<p class="status">That’s everything.{#if hidden} {hidden} hidden by your blocks.{/if}</p>{/if}
  <div bind:this={sentinel} class="sentinel" aria-hidden="true"></div>
</section>

<style>
  .river { display: flex; flex-direction: column; gap: 14px; }
  .day { display: flex; flex-direction: column; gap: 14px; }
  /* Sticky within its own day, so the next day's heading pushes it away instead of piling on. Bleeds into main's side padding so card shadows don't peek past it. */
  .dayhead { position: sticky; top: 0; z-index: 5; margin: 0 -12px; padding: 10px 12px 6px; font-size: 15px; font-weight: 600; color: var(--text-2); background: var(--bg); }
  .dayhead::after { content: ''; position: absolute; left: 0; right: 0; bottom: -8px; height: 8px; background: linear-gradient(var(--bg), transparent); pointer-events: none; }
  @media (min-width: 900px) { .dayhead { margin: 0 -24px; padding-left: 24px; padding-right: 24px; } }
  .empty { text-align: center; padding: 50px 20px; color: var(--text-2); }
  .empty h2 { font-family: var(--font-headings); color: var(--text); font-size: 24px; margin: 0 0 8px; }
  .empty p { margin: 0 auto; max-width: 440px; }
  .ctas { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; margin-top: 18px; }
  .cta { display: inline-block; background: var(--accent); color: var(--accent-ink); padding: 12px 20px; border-radius: 999px; font-weight: 600; }
  .cta.ghost { background: var(--surface); color: var(--text-2); border: 1px solid var(--line); }
  .status { text-align: center; color: var(--text-3); font-size: 14px; padding: 18px 0; margin: 0; }
  .status.error { color: var(--danger); }
  .sentinel { height: 1px; }
</style>
