<script lang="ts">
  /**
   * The stream. Newest first, keyset paginated. Scoped by nothing (Everything),
   * a collection subtree, or a single feed. The page around it owns the title;
   * this owns the list.
   *
   * Two layouts, one list. Scrolling: infinite scroll, cut into calendar days
   * with a heading that sticks to the top while that day's posts scroll under
   * it. Paged: as many posts as fit the screen at a fixed card height, then a
   * page turn; no scrolling, no motion, for e-ink and for anyone who prefers a
   * still page. The next page is fetched one page ahead so a turn is instant.
   */
  import { api, type RiverItem } from '$lib/api';
  import ItemCard from './ItemCard.svelte';
  import Pager from './Pager.svelte';
  import { openAddFeed } from '$lib/addfeed.svelte';
  import { dayKey, dayLabel } from '$lib/time';
  import { session } from '$lib/session.svelte';
  import { display } from '$lib/display.svelte';
  import { marks, loadMarks, anchorFor, advance, begin, recount, countText } from '$lib/marks.svelte';
  import { collectionStore, loadCollections } from '$lib/collections.svelte';
  import VisitorMore from './VisitorMore.svelte';
  import Button from '$lib/components/Button.svelte';

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
  /**
   * "What's new", as this list opened: the point where the reader last stopped
   * in this collection, and the count above it. Posts newer than the point are
   * marked, and a line sits where they end, for the whole visit, even as
   * reading moves the point on. null = not marking (option off, a single feed,
   * someone else's collection, or the first time here).
   */
  let anchorAtOpen = $state<string | null>(null);
  let newAtOpen = $state('');
  /** The collection whose point this list moves: the one shown, or the root for Everything. */
  const markId = $derived(feed !== null ? null : (collection ?? collectionStore.rootId));

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
  /** Today's group needs no heading — the top of the feed is obviously the latest. Older days keep their date dividers. */
  const todayKey = $derived(dayKey(new Date()));

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
    items = []; cursor = null; done = false; hidden = 0; cappedAt = null; pageIndex = 0; anchorAtOpen = null; newAtOpen = ''; caught = false;
    return loadMore(true).then(noteOpened);
  }

  /**
   * The first page is on screen. Opening moves nothing: the point where the
   * reader last stopped is read, kept for the visit, and used to mark what is
   * newer. Reading down to the line is what moves it (caughtUp, below). The first time
   * this device shows a collection there is no point yet; the newest post on
   * screen becomes it, so the next visit has something to measure from.
   */
  async function noteOpened() {
    if (!display.fresh || !session.user || markId === null) return;
    await Promise.all([loadMarks(), loadCollections()]);
    const id = markId;
    if (!id || !marks.byId[id]) return; // not one of mine
    const a = anchorFor(id);
    if (!a) { if (items[0]) begin(id, clampNow(items[0].publishedAt)); return; }
    anchorAtOpen = a;
    newAtOpen = countText(marks.byId[id]);
  }
  /** A post dated in the future would put the point ahead of posts still to arrive. */
  const clampNow = (iso: string) => (new Date(iso).getTime() > Date.now() ? new Date().toISOString() : iso);
  const isFresh = (item: RiverItem) => anchorAtOpen !== null && new Date(item.publishedAt) > new Date(anchorAtOpen);
  /**
   * Caught up: the reader has read down to the line, or said so. The point
   * moves to the newest post this visit started with, so the count drops and
   * the next visit's line lands here. The list is newest-first, so scrolling
   * past the top post proves nothing; reaching the line does. Leaving before
   * the line moves nothing, and next time the line is still where it was, with
   * the new arrivals above it.
   */
  let caught = $state(false);
  function caughtUp() {
    if (caught || !display.fresh || markId === null || !marks.byId[markId] || !items[0]) return;
    caught = true;
    advance(markId, clampNow(items[0].publishedAt));
    recount(markId, 0);
  }
  // Scrolling: the line coming into view is reaching it.
  let dividerEl = $state<HTMLElement | null>(null);
  $effect(() => {
    if (!dividerEl || caught) return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) caughtUp(); });
    io.observe(dividerEl);
    return () => io.disconnect();
  });
  // Pages: showing the page the line falls on, or the last page when everything is new, is reaching it.
  $effect(() => {
    if (!paged || anchorAtOpen === null || caught) return;
    if (pageItems.some((i) => i.id === boundaryId) || (boundaryAtEnd && (pageIndex + 1) * perPage >= items.length)) caughtUp();
  });
  /** Where the line goes: before the first post that is not new, if anything new sits above it. At the end if everything loaded is new and that is all there is. */
  const boundaryId = $derived.by(() => {
    if (anchorAtOpen === null || !items.length || !isFresh(items[0])) return null;
    return items.find((i) => !isFresh(i))?.id ?? null;
  });
  const boundaryAtEnd = $derived(anchorAtOpen !== null && done && items.length > 0 && isFresh(items[0]) && boundaryId === null);

  $effect(() => {
    const key = `${collection}|${feed}`;
    if (loadedKey === key) return;
    loadedKey = key;
    void reload();
  });

  // Scrolling layout: the sentinel below the list asks for more as it comes into view.
  $effect(() => {
    if (paged || !sentinel) return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) void loadMore(); }, { rootMargin: '1200px 0px' });
    io.observe(sentinel);
    return () => io.disconnect();
  });

  /* ---- Paged layout ---- */
  const paged = $derived(display.layout === 'paged');
  /** Compact cards are this tall, plus the gap; the frame is measured and divided. */
  const CARD_H = 148;
  const GAP = 12;
  const PAGEHEAD_H = 34;
  /** Cards go side by side when the frame is wide enough for more than one of at least this width; narrower than this a card reads oddly. */
  const CARD_MIN_W = 500;
  let frame = $state<HTMLElement | null>(null);
  let frameTop = $state(0);
  let frameH = $state(0);
  let cols = $state(1);
  let perPage = $state(3);
  let pageIndex = $state(0);

  /** The frame runs from wherever the page's own header ends to the top of the bottom bar. */
  function measure() {
    if (!frame) return;
    const top = frame.getBoundingClientRect().top + window.scrollY;
    const navH = 56 + Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--safe-b')) || 56;
    // main keeps its usual bottom padding (nav + 24px); take it off so the page itself has nothing to scroll.
    const h = Math.max(CARD_H + PAGEHEAD_H, window.innerHeight - top - navH - 26);
    frameTop = top; frameH = h;
    cols = Math.max(1, Math.floor((frame.clientWidth + GAP) / (CARD_MIN_W + GAP)));
    perPage = cols * Math.max(1, Math.floor((h - PAGEHEAD_H) / (CARD_H + GAP)));
  }
  $effect(() => {
    if (!paged || !frame) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(document.body);
    window.addEventListener('resize', measure);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
  });
  // Keep the current page in range when the frame changes size.
  $effect(() => { if (paged && items.length && pageIndex * perPage >= items.length) pageIndex = Math.max(0, Math.ceil(items.length / perPage) - 1); });

  const pageItems = $derived(paged ? items.slice(pageIndex * perPage, (pageIndex + 1) * perPage) : []);
  const canPrev = $derived(pageIndex > 0);
  const canNext = $derived((pageIndex + 1) * perPage < items.length || (!done && !cappedAt));
  const pageLabel = $derived.by(() => {
    if (!pageItems.length) return '';
    const today = dayKey(new Date());
    const clamp = (k: string) => (k > today ? today : k); // future-dated posts ride along with today's
    const first = dayLabel(clamp(dayKey(new Date(pageItems[0].publishedAt))));
    const last = dayLabel(clamp(dayKey(new Date(pageItems[pageItems.length - 1].publishedAt))));
    return first === last ? first : `${first} – ${last}`;
  });
  const pageCount = $derived(Math.ceil(items.length / perPage));

  async function nextPage() {
    if ((pageIndex + 1) * perPage >= items.length) {
      await loadMore();
      if ((pageIndex + 1) * perPage >= items.length) return;
    }
    pageIndex++;
    api.event('page_turned', { direction: 'next', page: pageIndex });
    prefetch();
  }
  function prevPage() { if (pageIndex > 0) { pageIndex--; api.event('page_turned', { direction: 'prev', page: pageIndex }); } }
  /** One page ahead is enough: a turn should never wait on the network. */
  function prefetch() { if ((pageIndex + 2) * perPage > items.length && !done) void loadMore(); }
  $effect(() => { if (paged && items.length) prefetch(); });
</script>

{#if paged}
  <section class="river paged" aria-live="polite" bind:this={frame} style:height="{frameH}px">
    {#if pageItems.length}
      <div class="pagehead"><span class="when">{pageLabel}</span>{#if newAtOpen}<span class="newn">{newAtOpen} new{#if !caught} · <button type="button" onclick={caughtUp}>I’m caught up</button>{/if}</span>{/if}<span class="n">Page {pageIndex + 1}{#if done} of {pageCount}{/if}</span></div>
      <div class="grid" style:grid-template-columns="repeat({cols}, minmax(0, 1fr))" style:grid-auto-rows="{CARD_H}px" style:gap="{GAP}px">
        {#each pageItems as item (item.id)}
          <ItemCard {item} {showSource} compact fresh={isFresh(item)} />
        {/each}
      </div>
    {:else if !loading && items.length === 0 && !error}
      <div class="empty">
        <h2>{emptyTitle}</h2>
        <p>{emptyBody}</p>
        <div class="ctas">
          {#if emptyHref}<Button variant="primary" size="lg" href={emptyHref}>{emptyCta}</Button>{:else if emptyAction}<Button variant="primary" size="lg" onclick={emptyAction}>{emptyCta}</Button>{/if}
          {#if collection === null && feed === null}<Button size="lg" href="/explore">Explore feeds</Button>{/if}
        </div>
      </div>
    {/if}
    {#if error}<p class="status error">Couldn’t load posts: {error}</p>{/if}
    {#if loading && !pageItems.length}<p class="status">Loading…</p>{/if}
    {#if cappedAt && !canNext}<VisitorMore cap={cappedAt} />{/if}
  </section>
  <Pager {canPrev} {canNext} onprev={prevPage} onnext={nextPage} label="page of posts" top="{frameTop}px" bottom="calc(var(--nav-h) + var(--safe-b))" />
{:else}
  <section class="river" aria-live="polite">
    {#if newAtOpen}
      <div class="newtop"><span>{newAtOpen} new since your last visit</span>{#if !caught}<button type="button" onclick={caughtUp}>I’m caught up</button>{/if}</div>
    {/if}
    {#each groups as g (g.key)}
      <section class="day">
        {#if g.key !== todayKey}<h2 class="dayhead">{g.label}</h2>{/if}
        {#each g.items as item (item.id)}
          {#if item.id === boundaryId}
            <div class="divider" role="separator" aria-label="End of what is new since your last visit" bind:this={dividerEl}><span>That’s everything new since your last visit</span></div>
          {/if}
          <ItemCard {item} {showSource} fresh={isFresh(item)} />
        {/each}
      </section>
    {/each}
    {#if boundaryAtEnd}
      <div class="divider" role="separator" aria-label="End of what is new since your last visit" bind:this={dividerEl}><span>That’s everything new since your last visit</span></div>
    {/if}

    {#if !loading && items.length === 0 && !error}
      <div class="empty">
        <h2>{emptyTitle}</h2>
        <p>{emptyBody}</p>
        <div class="ctas">
          {#if emptyHref}<Button variant="primary" size="lg" href={emptyHref}>{emptyCta}</Button>{:else if emptyAction}<Button variant="primary" size="lg" onclick={emptyAction}>{emptyCta}</Button>{/if}
          {#if collection === null && feed === null}<Button size="lg" href="/explore">Explore feeds</Button>{/if}
        </div>
      </div>
    {/if}
    {#if error}<p class="status error">Couldn’t load posts: {error}</p>{/if}
    {#if loading}<p class="status">Loading…</p>{/if}
    {#if cappedAt}<VisitorMore cap={cappedAt} />{:else if done && items.length > 0}<p class="status">That’s everything.{#if hidden} {hidden} hidden by your blocks.{/if}</p>{/if}
    <div bind:this={sentinel} class="sentinel" aria-hidden="true"></div>
  </section>
{/if}

<style>
  .river { display: flex; flex-direction: column; gap: 14px; }
  .day { display: flex; flex-direction: column; gap: 14px; }
  /* Sticky within its own day, so the next day's heading pushes it away instead of piling on. Bleeds into main's side padding so card shadows don't peek past it. */
  .dayhead { position: sticky; top: 0; z-index: 5; margin: 0 -12px; padding: 10px 12px 6px; font-size: calc(15px * var(--size-app)); font-weight: 600; color: var(--text-2); background: var(--bg); }
  .dayhead::after { content: ''; position: absolute; left: 0; right: 0; bottom: -8px; height: 8px; background: linear-gradient(var(--bg), transparent); pointer-events: none; }
  @media (min-width: 900px) { .dayhead { margin: 0 -24px; padding-left: 24px; padding-right: 24px; } }
  .empty { text-align: center; padding: 50px 20px; color: var(--text-2); }
  .empty h2 { font-family: var(--font-headings); color: var(--text); font-size: calc(24px * var(--size-headings)); margin: 0 0 8px; }
  .empty p { margin: 0 auto; max-width: 440px; }
  .ctas { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; margin-top: 18px; }
  .status { text-align: center; color: var(--text-3); font-size: calc(14px * var(--size-app)); padding: 18px 0; margin: 0; }
  .status.error { color: var(--danger); }
  .sentinel { height: 1px; }

  /* Paged: a fixed frame, nothing scrolls, nothing moves. */
  .river.paged { gap: 0; overflow: hidden; }
  /* "What's new": the line where the new posts end. Two colours only and no motion, so it reads on e-ink. */
  .divider { display: flex; align-items: center; gap: 12px; margin: 2px 0; color: var(--text-2); font-size: calc(13px * var(--size-app)); font-weight: 600; }
  .divider::before, .divider::after { content: ''; flex: 1; border-top: 2px solid var(--accent); }
  .divider span { flex: none; }
  .newn { color: var(--accent); font-weight: 700; margin-left: 10px; }
  .newn button, .newtop button { font: inherit; font-weight: 600; color: var(--accent); text-decoration: underline; text-underline-offset: 3px; }
  .newtop { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: -4px 0 -2px; font-size: calc(13px * var(--size-app)); color: var(--text-2); font-weight: 600; }
  .pagehead { display: flex; align-items: baseline; justify-content: space-between; height: 34px; padding: 6px 2px 0; font-size: calc(14px * var(--size-app)); color: var(--text-2); }
  .pagehead .when { font-weight: 600; }
  .pagehead .n { font-size: calc(13px * var(--size-app)); color: var(--text-3); font-variant-numeric: tabular-nums; }
  .grid { display: grid; align-content: start; }
</style>
