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
  let btns: HTMLButtonElement[] = $state([]);
  /* Whether the reader was inside the row just before the tabs changed, so
     focus can be rescued if the tab they were on has gone. */
  let wasInside = false;

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
  <div class="scroll">
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
</div>

<style>
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
