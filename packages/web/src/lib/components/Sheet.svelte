<script lang="ts">
  /**
   * The Sheet: a panel for one focused task, and the only way the app draws
   * one (issue #246), so a change here reaches every panel. On a phone it
   * rises from the bottom of the screen; from 700px up it sits centered.
   *
   * Top to bottom:
   * - The title and a close button. A panel about one thing (a feed) can swap
   *   the title for its own `header`, an icon and name, say; the close button
   *   stays, and `title` still names the panel for screen readers.
   * - The `lede`: one gray line under the title saying what the panel is for.
   *   Text, or a snippet when it carries more (a "Saved" note beside it).
   * - The task's content. Settings stacked one per row sit in a `sheet-rows`
   *   box, which splits them with a hairline.
   * - An optional `footer` pinned at the bottom for the one action that
   *   finishes the task: a button with the `sheet-action` class, full width,
   *   in the accent color, or `sheet-action danger` in red when finishing means
   *   deleting. Any other destructive choice is a red text link under it
   *   (`Button variant="danger" link`), never a button beside it. There is no
   *   Cancel: the close button, tapping outside, and Escape all do that.
   *
   * The content column never grows past the screen: any part of it that can
   * scroll (a long list) should say so with its own overflow, and everything
   * else keeps its height. When even that doesn't fit (the keyboard is up, or
   * the phone is on its side) the whole Sheet scrolls, so the footer's action
   * can always be reached. `locked` holds it open while something can't be
   * interrupted, such as a photo saving. `alert` marks a confirm that can't be
   * undone, so screen readers announce it as a warning. The parent opens it
   * with `dialog.showModal()`.
   */
  import type { Snippet } from 'svelte';
  import IconButton from './IconButton.svelte';

  let { title, dialog = $bindable(null), onclose, lede, header, children, footer, locked = false, alert = false }: {
    title: string; dialog?: HTMLDialogElement | null; onclose?: () => void;
    lede?: string | Snippet; header?: Snippet; children?: Snippet; footer?: Snippet;
    locked?: boolean; alert?: boolean;
  } = $props();
  const titleId = $props.id();
</script>

<dialog
  bind:this={dialog}
  {onclose}
  oncancel={(e) => { if (locked) e.preventDefault(); }}
  onclick={(e) => { if (e.target === dialog && !locked) dialog?.close(); }}
  role={alert ? 'alertdialog' : undefined}
  aria-labelledby={header ? undefined : titleId}
  aria-label={header ? title : undefined}
>
  <div class="sheet">
    <header>
      {#if header}<div class="custom">{@render header()}</div>{:else}<h2 id={titleId}>{title}</h2>{/if}
      <IconButton class="close" icon="close" label="Close" disabled={locked} onclick={() => dialog?.close()} />
    </header>
    {#if typeof lede === 'string'}<p class="lede">{lede}</p>
    {:else if lede}<div class="lede">{@render lede()}</div>{/if}
    {@render children?.()}
    {#if footer}<div class="foot">{@render footer()}</div>{/if}
  </div>
</dialog>

<style>
  dialog { border: 0; padding: 0; background: transparent; max-width: 100vw; max-height: 100vh; width: 100vw; height: 100vh; margin: 0; }
  dialog::backdrop { background: var(--scrim); }
  .sheet {
    position: fixed; left: 0; right: 0; bottom: 0; background: var(--surface); color: var(--text);
    border-radius: var(--radius-lg) var(--radius-lg) 0 0; padding: var(--space-4) var(--space-4) calc(var(--space-4) + var(--safe-b)); max-height: 90vh; max-height: 90dvh; overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain;
    box-shadow: var(--shadow-sheet); display: flex; flex-direction: column; gap: var(--space-3);
  }
  @media (min-width: 700px) {
    .sheet { left: 50%; right: auto; bottom: auto; top: 50%; transform: translate(-50%, -50%); width: 460px; border-radius: var(--radius-lg); max-height: 86vh; max-height: 86dvh; }
  }
  header { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); }
  /* A custom header takes the room; the close button keeps to the top corner beside it. */
  .custom { flex: 1; min-width: 0; }
  .custom + :global(.close) { align-self: flex-start; }
  h2 { margin: 0; font-size: calc(var(--text-xl) * var(--size-headings)); font-family: var(--font-headings); overflow-wrap: anywhere; }
  /* Pulled up against the title so the two read as one block. */
  .lede { margin: calc(-1 * var(--space-2)) 0 0; color: var(--text-2); font-size: calc(var(--text-sm) * var(--size-app)); line-height: 1.4; }
  div.lede { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); }
  div.lede :global(p) { margin: 0; }
  /* Settings one per row: each row's name above its choice, the rows split by a hairline. */
  .sheet :global(.sheet-rows > *) { display: flex; flex-direction: column; align-items: stretch; gap: var(--space-2); padding: var(--space-3) 0; border-top: 1px solid var(--line); }
  .sheet :global(.sheet-rows > :last-child) { padding-bottom: 0; }
  .foot { display: flex; flex-direction: column; gap: var(--space-2); margin-top: var(--space-2); }
  .foot :global(.sheet-action) { display: flex; align-items: center; justify-content: center; gap: var(--space-2); padding: var(--space-4); border-radius: var(--radius-md); background: var(--accent); color: var(--accent-ink); font-weight: 600; font-size: calc(var(--text-base) * var(--size-app)); }
  .foot :global(.sheet-action.danger) { background: var(--danger); color: var(--danger-ink); }
  .foot :global(.sheet-action:disabled) { opacity: 0.5; }
  /* A red text link under the main button sits centered beneath it. */
  .foot :global(.btn.link) { align-self: center; }
</style>
