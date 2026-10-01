<script lang="ts">
  import Select from './Select.svelte';

  /**
   * The one "pick one of these" row. A short row of joined options that sets a
   * value the moment you press one — a setting, not a set of tabs. Nothing
   * navigates and nothing is revealed elsewhere on the page; if pressing an
   * option should switch what you are looking at, that is a tab strip, not
   * this.
   *
   * Two sizes, both 14px text: md is the roomier row (8px above and below,
   * 16px each side), sm is the tighter one for a crowded settings row (8px by
   * 12px). `fill` makes every option the same width so they share the row.
   *
   * The chosen option is drawn three ways at once — a wash of the accent
   * color, accent-colored words, and its own outline repainted in the accent
   * color — so it still reads as chosen without relying on color.
   *
   * When the options can't sit on one line in the space they have, the control
   * turns into the dropdown (Select) with the same choices. It never wraps an
   * option onto two lines and never slides sideways. A color chip doesn't
   * carry over into the dropdown, whose menu the operating system draws.
   *
   * Keyboard: one stop on the way through, the chosen option. The arrow keys
   * move between options and pick as they go, wrapping around the ends, and
   * Home and End jump to the first and last. Options that are off are skipped.
   */

  interface Option {
    value: string;
    label: string;
    disabled?: boolean;
    /** A small round color chip before the words, e.g. an accent color. */
    swatch?: string;
    /** data-* attributes on this option, for a caller that styles it (a type preview). */
    data?: Record<string, string>;
  }

  interface Props {
    options: Option[];
    value: string;
    onchange: (value: string) => void;
    /** What the group is for. Read out in place of a visible heading. */
    label: string;
    size?: 'sm' | 'md';
    fill?: boolean;
    disabled?: boolean;
    class?: string;
    [key: string]: unknown;
  }

  let {
    options,
    value,
    onchange,
    label,
    size = 'md',
    fill = false,
    disabled = false,
    class: klass = '',
    ...rest
  }: Props = $props();

  let root = $state<HTMLDivElement>();
  let btns: HTMLButtonElement[] = $state([]);
  /* Whether the reader was inside the group just before the options changed,
     so focus can be rescued if the option they were on has gone. */
  let wasInside = false;

  const off = (i: number) => disabled || !!options[i]?.disabled;

  /* The single tab stop: the chosen option, or the first live one when the
     chosen value isn't in the list (or has just been switched off). */
  const stop = $derived.by(() => {
    const i = options.findIndex((o) => o.value === value && !o.disabled);
    return i >= 0 ? i : options.findIndex((o) => !o.disabled);
  });

  /* If the option that had focus is gone, put focus on the tab stop rather
     than letting it fall to the top of the page. The first of these runs
     before the row is redrawn, the second after it. */
  $effect.pre(() => {
    options;
    wasInside = !!root && root.contains(document.activeElement);
  });
  $effect(() => {
    options;
    if (!wasInside || !root || root.contains(document.activeElement)) return;
    btns[stop]?.focus();
  });

  function next(from: number, dir: 1 | -1) {
    const n = options.length;
    let i = from;
    for (let s = 0; s < n; s++) {
      i = (i + dir + n) % n;
      if (!off(i)) return i;
    }
    return -1;
  }

  function edge(dir: 1 | -1) {
    return dir === 1 ? next(-1, 1) : next(options.length, -1);
  }

  function go(i: number) {
    if (i < 0) return;
    btns[i]?.focus();
    if (options[i].value !== value) onchange(options[i].value);
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

  /**
   * Whether the options are too wide for one line in the space they have: a
   * small phone, a long set of words, large text. A cramped row doesn't wrap
   * and doesn't slide; the whole control becomes a dropdown instead, showing
   * the current choice (see the markup). The row stays in the page, unseen,
   * so it can be measured again when the space or the text size changes.
   */
  let opts = $state<HTMLDivElement>();
  let tight = $state(false);
  $effect(() => {
    const el = opts;
    if (!el) return;
    options;
    const measure = () => { tight = el.scrollWidth > el.clientWidth + 1; };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    for (const b of btns) if (b) ro.observe(b);
    measure();
    void document.fonts?.ready.then(measure);
    return () => ro.disconnect();
  });
</script>

<div bind:this={root} class="cg {size} {klass}" class:fill class:tight {...rest}>
  <div bind:this={opts} class="opts" role="radiogroup" aria-label={label} {onkeydown} inert={tight} aria-hidden={tight ? 'true' : undefined}>
    {#each options as o, i (o.value)}
      <button
        class="tap"
        bind:this={btns[i]}
        type="button"
        role="radio"
        aria-checked={o.value === value}
        class:on={o.value === value}
        tabindex={i === stop ? 0 : -1}
        disabled={disabled || o.disabled}
        onclick={() => o.value !== value && onchange(o.value)}
        {...o.data}
      >
        {#if o.swatch}<i class="sw" style="background:{o.swatch}" aria-hidden="true"></i>{/if}{o.label}
      </button>
    {/each}
  </div>
  {#if tight}
    <Select
      {size}
      {label}
      hideLabel
      {disabled}
      {value}
      options={options.map((o) => ({ value: o.value, label: o.label, disabled: o.disabled }))}
      onchange={(e) => e.currentTarget.value !== value && onchange(e.currentTarget.value)}
    />
  {/if}
</div>

<style>
  /* The outline belongs to the options, not to the row around them: each
     option draws its own box and overlaps its neighbor by a hairline, so
     they share one line between them. The chosen one then repaints that line
     in the accent color on all four of its sides. */
  .cg {
    display: inline-flex;
    flex-direction: column;
    max-width: 100%;
    min-width: 0;
  }
  .cg.fill {
    display: flex;
    width: 100%;
  }
  /* The row of options. It clips rather than scrolls: if it is clipping
     anything, the script has already swapped it for the dropdown. */
  .opts {
    display: flex;
    max-width: 100%;
    overflow: hidden;
  }
  /* The clipping would cut the options' taller touch area (see `.tap` in
     app.css) back to their drawn height. This gives the row that much room
     inside itself without moving anything around it. */
  @media (pointer: coarse) {
    .opts { padding-block: 3px; margin-block: -3px; }
  }
  /* Swapped for the dropdown: still laid out, so it can be measured, but it
     takes no height and can't be seen, tapped or tabbed to. */
  .cg.tight .opts {
    visibility: hidden;
    height: 0;
    padding-block: 0;
    margin-block: 0;
  }
  .cg.fill button {
    flex: 1;
  }
  .cg button {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    gap: var(--space-1);
    /* -1px is a hairline: the buttons share one border. */
    margin-left: -1px;
    padding: var(--space-2) var(--space-4);
    background: var(--surface);
    border: 1px solid var(--line);
    font-size: calc(var(--text-sm) * var(--size-app));
    font-weight: 600;
    color: var(--text-2);
    white-space: nowrap;
    transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease;
  }
  .cg.sm button {
    padding: var(--space-2) var(--space-3);
  }
  .cg button:first-child {
    margin-left: 0;
    border-radius: var(--radius-sm) 0 0 var(--radius-sm);
  }
  .cg button:last-child {
    border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  }
  .cg button:only-child {
    border-radius: var(--radius-sm);
  }

  .cg button:hover:not(.on):not(:disabled) {
    background: var(--surface-2);
    color: var(--text);
  }

  /* Chosen: a wash of the accent, accent words, and its own outline drawn in
     the accent color over its neighbors' — so it is not color alone that
     says which one is on. */
  .cg button.on {
    background: var(--accent-tint);
    color: var(--accent);
    border-color: var(--accent);
    position: relative;
    z-index: 1;
  }

  .cg button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
    position: relative;
    z-index: 2;
  }

  .cg button:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .sw {
    flex: none;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 1px solid var(--swatch-border);
  }
</style>
