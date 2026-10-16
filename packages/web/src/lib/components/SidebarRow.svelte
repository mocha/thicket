<script lang="ts">
  /**
   * One row of the left sidebar: a place you can go. The page you're on is
   * shaded and bold; with a mouse, a row shades as you point at it; a keyboard
   * focus draws the accent ring just inside its edge. A count of what's new
   * sits at the row's far end.
   *
   * Three kinds, and only three:
   *   page        the sidebar's main places (New posts, Collections, Bookmarks,
   *               Explore): an icon and the name, in body-size text
   *   collection  one of your collections, under Collections: the name alone,
   *               a size smaller, cut short with "…" when it's long. Something
   *               new turns the name bold. `indent` sets a collection inside
   *               another one further in.
   *   account     Notifications, at the foot by your account: smaller bold
   *               text, its icon centered over your picture below it, so the
   *               two rows line up
   *
   * `toggle` adds a caret at the row's end that folds away what's under it (the
   * Collections row). The name still goes to its page; the caret only folds,
   * and the two shade as one row.
   *
   * Where the row sits is the caller's business: pass a class and style the
   * position from the parent (with :global, since the class crosses into this
   * component).
   */
  import Badge from './Badge.svelte';
  import Icon from './Icon.svelte';

  type Toggle = { open: boolean; onclick: () => void; label: string; controls?: string };

  let {
    href,
    label,
    current = false,
    kind = 'page',
    icon,
    count = '',
    countLabel,
    isNew = false,
    indent = false,
    toggle,
    class: klass = ''
  }: {
    href: string;
    label: string;
    current?: boolean;
    kind?: 'page' | 'collection' | 'account';
    /** A 24×24 stroke path, from the menu's icons. */
    icon?: string;
    /** How many are new, already worded ("12", "99+"). Empty shows nothing. */
    count?: string;
    /** What a screen reader says for the count, when the number alone isn't enough. */
    countLabel?: string;
    isNew?: boolean;
    indent?: boolean;
    toggle?: Toggle;
    class?: string;
  } = $props();

  const ariaCurrent = $derived(current ? ('page' as const) : undefined);
</script>

{#snippet glyph(d: string)}
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path {d} /></svg>
{/snippet}

{#snippet inner()}
  {#if icon && kind === 'account'}<span class="slot">{@render glyph(icon)}</span>{:else if icon}{@render glyph(icon)}{/if}
  <span class="name">{label}</span>
  {#if count}<Badge tone="soft" class="count" aria-label={countLabel}>{count}</Badge>{/if}
{/snippet}

{#if toggle}
  <div class="row {kind} {klass}" class:current>
    <a class="link" {href} aria-current={ariaCurrent}>{@render inner()}</a>
    <button type="button" class="toggle" aria-expanded={toggle.open} aria-controls={toggle.controls} aria-label={toggle.label} onclick={toggle.onclick}>
      <Icon name="caret" size={14} stroke={2.5} dir={toggle.open ? 'down' : 'right'} />
    </button>
  </div>
{:else}
  <a class="row link {kind} {klass}" class:current class:new={isNew} class:indent {href} aria-current={ariaCurrent}>{@render inner()}</a>
{/if}

<style>
  .row {
    display: flex; align-items: center; width: 100%;
    border-radius: var(--radius-sm); color: var(--text-2);
    font-size: calc(var(--text-base) * var(--size-app));
    -webkit-tap-highlight-color: transparent;
  }
  .link { gap: var(--space-3); padding: var(--space-2) var(--space-3); border-radius: var(--radius-sm); }
  .current { background: var(--surface-2); color: var(--text); font-weight: 600; }
  /* Drawn just inside the row, in the accent color like the kit's other rings. */
  .link:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .row :global(.count) { margin-left: auto; }

  /* With a caret: the name is the link, the caret folds; they shade as one row. */
  div.row .link { display: flex; align-items: center; flex: 1; min-width: 0; padding-right: 0; color: inherit; }
  .toggle { flex: none; display: grid; place-items: center; width: 32px; align-self: stretch; margin-right: var(--space-1); border-radius: var(--radius-sm); color: var(--text-3); }

  .collection { gap: var(--space-2); font-size: calc(var(--text-sm) * var(--size-app)); }
  .collection .name { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  /* Something new: the name goes bold, the count sits beside it. Bold reads in grayscale where a color would not. */
  .collection.new .name { font-weight: 500; color: var(--text); }
  .indent { padding-left: var(--space-5); }

  /* Lined up with the account row under it: the icon centered in the picture's
     column, the label on the name's edge in the name's type. */
  .account { font-size: calc(var(--text-sm) * var(--size-app)); font-weight: 600; }
  .slot { flex: none; display: grid; place-items: center; width: 34px; }

  /* Hover shading only where there's a mouse. A tap on a touchscreen leaves
     hover stuck on, so the row you last tapped stays shaded like the current page. */
  @media (hover: hover) {
    .row:hover { background: var(--surface-2); }
    .toggle:hover { color: var(--text); }
  }
</style>
