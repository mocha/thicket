<script lang="ts">
  /**
   * The one "switch what you're looking at" row. A short row of tabs sitting in
   * an inset track; pressing one swaps the content below it for something else.
   *
   * This is not ChoiceGroup. ChoiceGroup sets a value and nothing else moves —
   * a setting. Tabs change what is on the page. If nothing is revealed or
   * replaced when you press an option, it is a ChoiceGroup.
   *
   * The look: a sunken track the width of the row, with the chosen tab lifted
   * out of it onto a card of its own — its own background, darker words, and a
   * soft shadow. On the two hard-edged themes, which have no shadow and no
   * second surface color, the lifted tab is outlined instead so it still reads
   * as chosen.
   *
   * A tab can carry a count after its words. The count is the same color as
   * the words at normal weight, not a fainter gray: a gray light enough to
   * read as "quiet" doesn't have the contrast to be readable. Numbers use
   * tabular figures so a count ticking from 9 to 10 doesn't shuffle the row.
   *
   * `fill` shares the row out evenly between the tabs, for a fixed handful of
   * them. Leave it off when the number of tabs varies with the data — a row
   * too long for its space slides sideways instead, and the lifted tab keeps
   * its shadow at both ends.
   *
   * A row that is too long says so: the end with tabs hidden behind it softens
   * into the page rather than slicing a word in half, and a small arrow floats
   * there to move the row along by most of a screenful. Both appear only on
   * the side that actually has something hidden, and the arrows are left out
   * on a touchscreen, where the row is swiped. The chosen tab is brought back
   * into view whenever it would be left off the end — on the way in, when the
   * choice changes, and when the window changes shape.
   *
   * Keyboard: one stop on the way through, the chosen tab. The arrow keys move
   * between tabs and switch as they go, wrapping around the ends, and Home and
   * End jump to the first and last. Tabs that are off are skipped. If the tab
   * that had focus disappears — the row can grow and shrink as the data does —
   * focus lands on the chosen one rather than falling to the top of the page.
   *
   * Screen readers: pass `panel` — the id of the region this row switches —
   * and put `role="tabpanel"` and that same id on that region, so the tabs and
   * what they control are announced as one thing.
   */

  import IconButton from './IconButton.svelte';

  interface Tab {
    value: string;
    label: string;
    /** A number after the words, e.g. how many results this tab holds. */
    count?: number | string;
    disabled?: boolean;
  }

  interface Props {
    tabs: Tab[];
    value: string;
    onchange: (value: string) => void;
    /** What this row switches between. Read out in place of a visible heading. */
    label: string;
    /** id of the region these tabs switch. The caller marks that region up. */
    panel?: string;
    /** Share the row out evenly between the tabs. */
    fill?: boolean;
    class?: string;
    [key: string]: unknown;
  }

  let {
    tabs,
    value,
    onchange,
    label,
    panel,
    fill = false,
    class: klass = '',
    ...rest
  }: Props = $props();

  let root = $state<HTMLDivElement>();
  let scroller = $state<HTMLDivElement>();
  let btns: HTMLButtonElement[] = $state([]);
  /* Whether the reader was inside the row just before the tabs changed, so
     focus can be rescued if the tab they were on has gone. */
  let wasInside = false;
  /* Whether there are tabs hidden off each end. Drives the soft edge that says
     "more this way" instead of cutting a word in half. */
  let moreLeft = $state(false);
  let moreRight = $state(false);

  const off = (i: number) => !!tabs[i]?.disabled;

  /* The single tab stop: the chosen tab, or the first live one when the chosen
     value isn't in the row (or has just been switched off). */
  const stop = $derived.by(() => {
    const i = tabs.findIndex((t) => t.value === value && !t.disabled);
    return i >= 0 ? i : tabs.findIndex((t) => !t.disabled);
  });

  /* The first of these runs before the row is redrawn, the second after it. */
  $effect.pre(() => {
    tabs;
    wasInside = !!root && root.contains(document.activeElement);
  });
  $effect(() => {
    tabs;
    if (!wasInside || !root || root.contains(document.activeElement)) return;
    btns[stop]?.focus();
  });

  function measure() {
    if (!scroller) return;
    const { scrollLeft, clientWidth, scrollWidth } = scroller;
    /* A pixel of slack: scroll positions are fractional at some zoom levels. */
    moreLeft = scrollLeft > 1;
    moreRight = scrollLeft + clientWidth < scrollWidth - 1;
  }

  /* Bring the chosen tab back into view when it is off the end — on the way in
     and whenever the choice or the row changes. Only this row scrolls
     sideways: the page itself is left where the reader put it. */
  function reveal() {
    const el = btns[stop];
    if (!el || !scroller) return;
    const tab = el.getBoundingClientRect();
    const box = scroller.getBoundingClientRect();
    const room = 8;
    if (tab.left < box.left + room) scroller.scrollLeft -= box.left + room - tab.left;
    else if (tab.right > box.right - room) scroller.scrollLeft += tab.right - (box.right - room);
  }

  $effect(() => {
    tabs;
    value;
    if (!scroller) return;
    reveal();
    measure();
  });

  /* The row overflows or stops overflowing as the window, the type size or the
     tabs themselves change — and the chosen tab can be carried off the edge by
     the change, so it is brought back each time too. */
  $effect(() => {
    if (!scroller || !root) return;
    const ro = new ResizeObserver(() => {
      reveal();
      measure();
    });
    ro.observe(scroller);
    ro.observe(root);
    return () => ro.disconnect();
  });

  /* A press of an arrow moves the row by most of a screenful, leaving a tab or
     two of overlap so the reader keeps their place. */
  function nudge(dir: 1 | -1) {
    if (!scroller) return;
    scroller.scrollBy({ left: dir * scroller.clientWidth * 0.8, behavior: 'smooth' });
  }

  function next(from: number, dir: 1 | -1) {
    const n = tabs.length;
    let i = from;
    for (let s = 0; s < n; s++) {
      i = (i + dir + n) % n;
      if (!off(i)) return i;
    }
    return -1;
  }

  function edge(dir: 1 | -1) {
    return dir === 1 ? next(-1, 1) : next(tabs.length, -1);
  }

  function go(i: number) {
    if (i < 0) return;
    btns[i]?.focus();
    if (tabs[i].value !== value) onchange(tabs[i].value);
  }

  function onkeydown(e: KeyboardEvent) {
    const from = btns.indexOf(e.target as HTMLButtonElement);
    if (from < 0) return;
    const k = e.key;
    if (k === 'ArrowLeft' || k === 'ArrowUp') go(next(from, -1));
    else if (k === 'ArrowRight' || k === 'ArrowDown') go(next(from, 1));
    else if (k === 'Home') go(edge(1));
    else if (k === 'End') go(edge(-1));
    else return;
    e.preventDefault();
  }
</script>

<!-- Three elements, not one. The outer one is the caller's to position. The
     middle one does the sideways scrolling, with a little room above and below
     so it never crops the lifted tab's shadow — room it then takes back off
     the layout, so the row still sits exactly where it is put. The inner one
     is the track the reader sees. -->
<div class="tabs {klass}" class:fill {...rest}>
  <div
    bind:this={scroller}
    class="scroll"
    class:more-left={moreLeft}
    class:more-right={moreRight}
    onscroll={measure}
  >
    <div bind:this={root} class="track" role="tablist" aria-label={label}>
      {#each tabs as t, i (t.value)}
        <button
          bind:this={btns[i]}
          type="button"
          role="tab"
          aria-selected={t.value === value}
          aria-controls={panel}
          tabindex={i === stop ? 0 : -1}
          disabled={t.disabled}
          onclick={() => t.value !== value && onchange(t.value)}
          {onkeydown}
        >
          {t.label}{#if t.count !== undefined}<span class="n">{t.count}</span>{/if}
        </button>
      {/each}
    </div>
  </div>
  <!-- The arrows sit outside the list of tabs, so they are never mistaken for
       one, and float over the soft edge without taking any room. They are for
       a mouse; on a touchscreen the row is swiped and only the soft edge
       shows. -->
  {#if moreLeft}
    <div class="arrow left">
      <IconButton icon="caret" dir="left" size="sm" label="Scroll tabs left" onclick={() => nudge(-1)} />
    </div>
  {/if}
  {#if moreRight}
    <div class="arrow right">
      <IconButton icon="caret" dir="right" size="sm" label="Scroll tabs right" onclick={() => nudge(1)} />
    </div>
  {/if}
</div>

<style>
  .tabs {
    position: relative;
  }

  /* Over the soft edge, not beside it: the arrows take no room, so turning
     them on and off never moves the tabs. */
  .arrow {
    position: absolute;
    top: 0;
    bottom: 0;
    display: flex;
    align-items: center;
  }
  .arrow.left {
    left: 0;
  }
  .arrow.right {
    right: 0;
  }
  /* The arrow sits on the page, not on the tabs: its own small disc, outlined
     so it reads as something to press on every theme. */
  .arrow :global(.ib) {
    background: var(--bg);
    box-shadow: 0 0 0 1px var(--line);
  }
  /* On a touchscreen the row is swiped, so the soft edge says it all. */
  @media (hover: none) {
    .arrow {
      display: none;
    }
  }

  .scroll {
    /* The padding is the room the lifted tab's shadow needs; the matching
       negative margin takes it back off the layout. */
    padding: 6px 0;
    margin: -6px 0;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
  }
  .scroll::-webkit-scrollbar {
    display: none;
  }

  /* Tabs hidden off an end: that end softens into the page instead of being
     sliced off mid-word, which is the only hint a reader gets that the row
     slides. A row that fits gets no mask at all. */
  .scroll.more-left,
  .scroll.more-right {
    --fade-l: 0px;
    --fade-r: 0px;
    -webkit-mask-image: linear-gradient(
      to right,
      transparent 0,
      #000 var(--fade-l),
      #000 calc(100% - var(--fade-r)),
      transparent 100%
    );
    mask-image: linear-gradient(
      to right,
      transparent 0,
      #000 var(--fade-l),
      #000 calc(100% - var(--fade-r)),
      transparent 100%
    );
  }
  .scroll.more-left {
    --fade-l: 28px;
  }
  .scroll.more-right {
    --fade-r: 28px;
  }

  .track {
    display: inline-flex;
    /* Fills the row when the tabs are short, grows past it when they aren't. */
    min-width: 100%;
    gap: 2px;
    padding: var(--space-1);
    border-radius: var(--radius-pill);
    background: var(--surface-2);
  }

  .track button {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    /* Transparent by default so the outline the hard-edged themes draw on the
       chosen tab costs no width. */
    border: 1px solid transparent;
    border-radius: var(--radius-pill);
    font-size: calc(var(--text-sm) * var(--size-app));
    font-weight: 600;
    color: var(--text-2);
    white-space: nowrap;
    transition: background 0.12s ease, color 0.12s ease;
  }
  .fill .track button {
    flex: 1;
  }

  .track button:hover:not([aria-selected='true']):not(:disabled) {
    color: var(--text);
  }

  /* Lifted out of the track: its own surface, darker words, a soft shadow —
     and, where there is no shadow to give, a drawn outline. */
  .track button[aria-selected='true'] {
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow);
    border: var(--card-border, 1px solid transparent);
  }

  .track button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  .track button:disabled {
    opacity: 0.4;
    cursor: default;
  }

  /* Same color as the words at normal weight: a fainter gray would not be
     readable. */
  .n {
    font-weight: 400;
    color: var(--text-2);
    font-variant-numeric: tabular-nums;
  }
</style>
