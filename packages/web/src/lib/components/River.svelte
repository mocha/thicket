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
  import { display, sizeScale } from '$lib/display.svelte';
  import { marks, loadMarks, anchorFor, advance, begin, recount, countText } from '$lib/marks.svelte';
  import { collectionStore, loadCollections } from '$lib/collections.svelte';
  import VisitorMore from './VisitorMore.svelte';
  import ExploreMore from './ExploreMore.svelte';
  import Button from '$lib/components/Button.svelte';
  import { recall, keepOnLeave } from '$lib/listmemory';

  let { collection = null, feed = null, linkSource = true, emptyTitle = 'Nothing here yet', emptyBody = 'thicket shows the posts of sites you follow, newest first, with nothing in between. Add a site by its address and its posts start arriving here, or look through Explore to see what other people here read.', emptyHref = null, emptyCta = 'Add a feed', emptyAction = () => openAddFeed({ via: 'empty_river' }), emptyPoll = false }: {
    collection?: number | null; feed?: number | null; linkSource?: boolean;
    emptyTitle?: string; emptyBody?: string; emptyHref?: string | null; emptyCta?: string;
    /** null = no call to action. Default opens the Add sheet. */
    emptyAction?: (() => void) | null;
    /** Look again while this list is empty: for feeds just added, whose first fetch is still to come. */
    emptyPoll?: boolean;
  } = $props();

  /** Back or Forward to this list: pick up exactly where it was left, rather than reloading from the top. */
  type Kept = {
    items: RiverItem[]; cursor: string | null; done: boolean; hidden: number; cappedAt: number | null; loadedKey: string | undefined;
    anchorAtOpen: string | null; newAtOpen: string; caught: boolean; pageIndex: number;
  };
  const listName = () => `river|${collection}|${feed}`;
  const back = recall<Kept>(listName());

  let items = $state<RiverItem[]>(back?.items ?? []);
  let cursor = $state<string | null>(back?.cursor ?? null);
  let done = $state(back?.done ?? false);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let hidden = $state(back?.hidden ?? 0);
  /**
   * What a screen reader is told when the list changes: one short line ("30
   * more posts loaded"), not the list itself. The whole list used to be marked
   * as "read out any change", which read every newly loaded card aloud.
   */
  let announce = $state('');
  /** Set when a visitor without an account has had all the instance lets visitors see; the number is that limit. */
  let cappedAt = $state<number | null>(back?.cappedAt ?? null);
  let sentinel = $state<HTMLElement | null>(null);
  let loadedKey = $state<string | undefined>(back?.loadedKey);
  /**
   * "What's new", as this list opened: the point where the reader last stopped
   * in this collection, and the count above it. Posts newer than the point are
   * marked, and a line sits where they end, for the whole visit, even as
   * reading moves the point on. null = not marking (option off, a single feed,
   * someone else's collection, or the first time here).
   */
  let anchorAtOpen = $state<string | null>(back?.anchorAtOpen ?? null);
  let newAtOpen = $state(back?.newAtOpen ?? '');
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
      // Scrolling only: a page turn says its own page number, and the first load is the page arriving.
      if (!reset && !paged) {
        const n = pg.items.length;
        // The running total keeps each line different from the last; a line repeated word for word is not read out again.
        announce = [n ? `${n} more ${n === 1 ? 'post' : 'posts'} loaded, ${items.length} in all.` : '', done && !cappedAt ? 'That’s everything.' : ''].filter(Boolean).join(' ');
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  /**
   * Feeds that were just added have not been fetched yet, so the list they are
   * in opens empty and fills a minute or two later. While that is the case,
   * look again rather than making someone reload the page: the scheduler ticks
   * every 15 seconds, so a minute is soon enough to feel live and rare enough
   * to be free. Stops the moment anything arrives, pauses while the tab is in
   * the background, and gives up after POLL_FOR — a list still empty by then
   * is not waiting on a first fetch, it is empty.
   */
  const POLL_MS = 60_000;
  const POLL_FOR = 10 * 60_000;
  let pollUntil = 0;
  $effect(() => {
    if (!emptyPoll || error || items.length) return;
    if (!pollUntil) pollUntil = Date.now() + POLL_FOR;
    if (Date.now() > pollUntil) return;
    const id = setInterval(() => {
      if (loading || document.visibilityState !== 'visible') return;
      void loadMore(true);
    }, POLL_MS);
    return () => clearInterval(id);
  });

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
  let caught = $state(back?.caught ?? false);
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
  /**
   * Compact cards are this tall, plus the gap; the frame is measured and
   * divided. The height is made of the card's parts, each grown by the text
   * size the reader chose for it: the source line (fixed room for its buttons),
   * two lines of title, two of summary, and the author. At the default sizes
   * that comes to 148. A fixed height would slice bigger text in half.
   */
  const CARD_H = $derived(Math.round(40 + 54 * sizeScale(display.fonts.headings.size) + 34 * sizeScale(display.fonts.reading.size) + 20 * sizeScale(display.fonts.app.size)));
  /** A card grows to share out whatever height is left over, up to half again its own. Past that a card is mostly air. */
  let cardH = $state(148);
  const GAP = 12;
  const PAGEHEAD_H = $derived(Math.round(34 * sizeScale(display.fonts.app.size)));
  /** Cards go side by side when the frame is wide enough for more than one of at least this width; narrower than this a card reads oddly. */
  const CARD_MIN_W = 500;
  let frame = $state<HTMLElement | null>(null);
  let frameTop = $state(0);
  let frameH = $state(0);
  let cols = $state(1);
  let perPage = $state(3);
  let pageIndex = $state(back?.pageIndex ?? 0);

  keepOnLeave(listName, () => ({ items, cursor, done, hidden, cappedAt, loadedKey, anchorAtOpen, newAtOpen, caught, pageIndex }));

  /** The frame runs from wherever the page's own header ends to the top of the bottom bar. */
  function measure() {
    if (!frame) return;
    const top = frame.getBoundingClientRect().top + window.scrollY;
    // The bottom bar as drawn: it grows with the text size too.
    const navH = document.querySelector<HTMLElement>('nav[aria-label="Primary"]')?.offsetHeight ?? 56;
    // main keeps its usual bottom padding (nav + 24px); take it off so the page itself has nothing to scroll.
    const h = Math.max(CARD_H + PAGEHEAD_H, window.innerHeight - top - navH - 26);
    frameTop = top; frameH = h;
    cols = Math.max(1, Math.floor((frame.clientWidth + GAP) / (CARD_MIN_W + GAP)));
    const rows = Math.max(1, Math.floor((h - PAGEHEAD_H + GAP) / (CARD_H + GAP)));
    // The height left after the last whole card is shared among the cards
    // rather than left as a blank band at the foot of the page: each gets a
    // little taller, which on a phone is room for another line of the summary.
    cardH = Math.min(Math.round(CARD_H * 1.5), Math.max(CARD_H, Math.floor((h - PAGEHEAD_H - (rows - 1) * GAP) / rows)));
    perPage = cols * rows;
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
  $effect(() => { if (paged && slots && pageIndex * perPage >= slots) pageIndex = Math.max(0, Math.ceil(slots / perPage) - 1); });

  /**
   * Someone signed in who has reached the oldest post gets a pointer to
   * Explore at the very end. A visitor held to the newest posts gets
   * VisitorMore there instead.
   */
  const endsInExplore = $derived(done && !cappedAt && items.length > 0 && !!session.user);
  const endFrom = $derived(feed !== null ? 'feed' : collection !== null ? 'collection' : 'everything');
  /** In pages the pointer takes one card's place after the last post, so the frame never cuts it off. */
  const slots = $derived(items.length + (endsInExplore ? 1 : 0));
  const pageItems = $derived(paged ? items.slice(pageIndex * perPage, (pageIndex + 1) * perPage) : []);
  const endOnPage = $derived(paged && endsInExplore && items.length >= pageIndex * perPage && items.length < (pageIndex + 1) * perPage);
  const canPrev = $derived(pageIndex > 0);
  const canNext = $derived((pageIndex + 1) * perPage < slots || (!done && !cappedAt));
  const pageLabel = $derived.by(() => {
    if (!pageItems.length) return endOnPage ? 'The end' : '';
    const today = dayKey(new Date());
    const clamp = (k: string) => (k > today ? today : k); // future-dated posts ride along with today's
    const first = dayLabel(clamp(dayKey(new Date(pageItems[0].publishedAt))));
    const last = dayLabel(clamp(dayKey(new Date(pageItems[pageItems.length - 1].publishedAt))));
    return first === last ? first : `${first} – ${last}`;
  });
  const pageCount = $derived(Math.ceil(slots / perPage));

  async function nextPage() {
    if ((pageIndex + 1) * perPage >= items.length) {
      await loadMore();
      if ((pageIndex + 1) * perPage >= slots) return;
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
  <section class="river paged" bind:this={frame} style:height="{frameH}px">
    {#if pageItems.length || endOnPage}
      <div class="pagehead" style:height="{PAGEHEAD_H}px"><h2 class="when">{pageLabel}</h2>{#if newAtOpen}<span class="newn">{newAtOpen} new{#if !caught} · <button type="button" onclick={caughtUp}>I’m caught up</button>{/if}</span>{/if}<span class="n" role="status">Page {pageIndex + 1}{#if done} of {pageCount}{/if}</span></div>
      <div class="grid" style:grid-template-columns="repeat({cols}, minmax(0, 1fr))" style:grid-auto-rows="{cardH}px" style:gap="{GAP}px">
        {#each pageItems as item (item.id)}
          <ItemCard {item} {linkSource} compact fresh={isFresh(item)} />
        {/each}
        {#if endOnPage}<div class="endcell"><ExploreMore {hidden} from={endFrom} /></div>{/if}
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
    {#if error}<p class="status error" role="alert">Couldn’t load posts: {error}</p>{/if}
    {#if loading && !pageItems.length}<p class="status">Loading…</p>{/if}
    {#if cappedAt && !canNext}<VisitorMore cap={cappedAt} />{/if}
  </section>
  <Pager {canPrev} {canNext} onprev={prevPage} onnext={nextPage} label="page of posts" top="{frameTop}px" bottom="calc(var(--nav-h) + var(--safe-b))" />
{:else}
  <section class="river">
    <p class="visually-hidden" role="status">{announce}</p>
    {#if newAtOpen}
      <div class="newtop"><span>{newAtOpen} new since your last visit</span>{#if !caught}<button type="button" onclick={caughtUp}>I’m caught up</button>{/if}</div>
    {/if}
    {#each groups as g (g.key)}
      <section class="day">
        <!-- Today's posts need no heading to look at, but they keep one to be read out, so the headings run page, day, post with no step missing. -->
        <h2 class={g.key === todayKey ? 'visually-hidden' : 'dayhead'}>{g.label}</h2>
        {#each g.items as item (item.id)}
          {#if item.id === boundaryId}
            <div class="divider" role="separator" aria-label="End of what is new since your last visit" bind:this={dividerEl}><span>That’s everything new since your last visit</span></div>
          {/if}
          <ItemCard {item} {linkSource} fresh={isFresh(item)} />
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
    {#if error}<p class="status error" role="alert">Couldn’t load posts: {error}</p>{/if}
    {#if loading}<p class="status">Loading…</p>{/if}
    {#if cappedAt}<VisitorMore cap={cappedAt} />{:else if endsInExplore}<ExploreMore {hidden} from={endFrom} />{:else if done && items.length > 0}<p class="status">That’s everything.{#if hidden} {hidden} hidden by your blocks.{/if}</p>{/if}
    <div bind:this={sentinel} class="sentinel" aria-hidden="true"></div>
  </section>
{/if}

<style>
  .river { display: flex; flex-direction: column; gap: var(--space-3); }
  .day { display: flex; flex-direction: column; gap: var(--space-3); }
  /* Sticky within its own day, so the next day's heading pushes it away instead of piling on. Bleeds into main's side padding so card shadows don't peek past it. */
  .dayhead { position: sticky; top: 0; z-index: 5; margin: 0 calc(-1 * var(--space-3)); padding: var(--space-3) var(--space-3) var(--space-2); font-size: calc(var(--text-base) * var(--size-app)); font-weight: 600; color: var(--text-2); background: var(--bg); }
  .dayhead::after { content: ''; position: absolute; left: 0; right: 0; bottom: calc(-1 * var(--space-2)); height: 8px; background: linear-gradient(var(--bg), transparent); pointer-events: none; }
  @media (min-width: 900px) and (min-height: 501px), (min-width: 900px) and (pointer: fine) { .dayhead { margin: 0 calc(-1 * var(--space-5)); padding-left: var(--space-5); padding-right: var(--space-5); } }
  .empty { text-align: center; padding: calc(var(--space-6) + var(--space-4)) var(--space-5); color: var(--text-2); }
  .empty h2 { font-family: var(--font-headings); color: var(--text); font-size: calc(var(--text-2xl) * var(--size-headings)); margin: 0 0 var(--space-2); }
  .empty p { margin: 0 auto; max-width: 440px; }
  .ctas { display: flex; gap: var(--space-2); justify-content: center; flex-wrap: wrap; margin-top: var(--space-4); }
  .status { text-align: center; color: var(--text-2); font-size: calc(var(--text-sm) * var(--size-app)); padding: var(--space-4) 0; margin: 0; }
  .status.error { color: var(--danger); }
  .sentinel { height: 1px; }

  /* Paged: a fixed frame, nothing scrolls, nothing moves. */
  .river.paged { gap: 0; overflow: hidden; }
  /* "What's new": the line where the new posts end. Two colors only and no motion, so it reads on e-ink. */
  /* 2px is an optical nudge so the rule sits between two cards, not against one. */
  .divider { display: flex; align-items: center; gap: var(--space-3); margin: 2px 0; color: var(--text-2); font-size: calc(var(--text-sm) * var(--size-app)); font-weight: 600; }
  .divider::before, .divider::after { content: ''; flex: 1; border-top: 2px solid var(--accent); }
  .divider span { flex: none; }
  .newn { color: var(--accent); font-weight: 700; margin-left: var(--space-3); }
  .newn button, .newtop button { font: inherit; font-weight: 600; color: var(--accent); text-decoration: underline; text-underline-offset: 3px; }
  .newtop { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); margin: calc(-1 * var(--space-1)) 0 -2px; font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); font-weight: 600; }
  .pagehead { display: flex; align-items: baseline; justify-content: space-between; padding: var(--space-2) 2px 0; font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); }
  .pagehead .when { margin: 0; font: inherit; font-weight: 600; }
  .pagehead .n { font-size: calc(var(--text-xs) * var(--size-app)); color: var(--text-2); font-variant-numeric: tabular-nums; }
  .grid { display: grid; align-content: start; }
  .endcell { display: flex; flex-direction: column; justify-content: center; }
</style>
