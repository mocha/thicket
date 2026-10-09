<script lang="ts">
  /**
   * The Sheet: a panel for one focused task, and the only way the app draws
   * one (issue #246), so a change here reaches every panel. On a phone it
   * rises from the bottom of the screen; from 700px up it sits centered.
   *
   * Top to bottom:
   * - The title. A panel about one thing (a feed) can swap it for its own
   *   `header`, an icon and name, say; `title` still names the panel for
   *   screen readers. An `aside` sits at the header's right, for an action
   *   about that one thing (Follow, on a feed).
   * - The `lede`, the panel's description: a short sentence under the title
   *   saying what the panel is for. Leave it off when the title already says
   *   it all (Following needs nothing more).
   *   Text, or a snippet when it carries more (a "Saved" note beside it).
   * - The task's content. Settings stacked one per row sit in a `sheet-rows`
   *   box, which splits them with a hairline.
   * - An optional `footer` pinned at the bottom for the one action that
   *   finishes the task: the shared Button, `variant="primary" size="lg"`, or
   *   `variant="danger" solid size="lg"` when finishing means deleting. The
   *   Sheet stretches it to full width. Any other destructive choice is a red
   *   text link under it (`Button variant="danger" link`), never a button
   *   beside it.
   * - The way out, always last and in words (issue #246): a full-width ghost
   *   Button, Cancel, under the footer's button, so it never reads as the main
   *   action and is as big a target as the button above it. In a panel with no
   *   footer because each choice saves as it's made, it's a primary Done.
   *   `dismiss` renames it, or `false` leaves it off when the footer already
   *   closes the panel. Tapping outside and Escape close it too. In an
   *   `alert`, focus starts on Cancel, so the safe choice is the one a keyboard
   *   or screen reader lands on.
   *
   * The content column never grows past the screen: any part of it that can
   * scroll (a long list) should say so with its own overflow, and everything
   * else keeps its height. When even that doesn't fit (the keyboard is up, or
   * the phone is on its side) the whole Sheet scrolls, so the footer's action
   * can always be reached. `locked` holds it open while something can't be
   * interrupted, such as a photo saving. `alert` marks a confirm that can't be
   * undone, so screen readers announce it as a warning, reading the lede with it (or the body, when there's no lede). The parent opens it
   * with `dialog.showModal()`.
   */
  import type { Snippet } from 'svelte';
  import Button from './Button.svelte';

  let { title, dialog = $bindable(null), onclose, lede, header, aside, children, footer, dismiss, locked = false, alert = false }: {
    title: string; dialog?: HTMLDialogElement | null; onclose?: () => void;
    lede?: string | Snippet; header?: Snippet; aside?: Snippet; children?: Snippet; footer?: Snippet;
    dismiss?: string | false; locked?: boolean; alert?: boolean;
  } = $props();
  const way = $derived(dismiss ?? (footer ? 'Cancel' : 'Done'));
  const titleId = $props.id();
  const ledeId = `${titleId}-lede`;
  const bodyId = `${titleId}-body`;
</script>

<dialog
  bind:this={dialog}
  {onclose}
  oncancel={(e) => { if (locked) e.preventDefault(); }}
  onclick={(e) => { if (e.target === dialog && !locked) dialog?.close(); }}
  role={alert ? 'alertdialog' : undefined}
  aria-labelledby={header ? undefined : titleId}
  aria-label={header ? title : undefined}
  aria-describedby={alert ? (lede ? ledeId : bodyId) : undefined}
>
  <div class="sheet">
    <header>
      {#if header}<div class="custom">{@render header()}</div>{:else}<h2 id={titleId}>{title}</h2>{/if}
      {#if aside}<div class="aside">{@render aside()}</div>{/if}
    </header>
    {#if typeof lede === 'string'}<p class="lede" id={ledeId}>{lede}</p>
    {:else if lede}<div class="lede" id={ledeId}>{@render lede()}</div>{/if}
    <!-- A confirm with no description is described by its body, so the warning is read with the title. -->
    {#if alert && !lede}<div class="body" id={bodyId}>{@render children?.()}</div>{:else}{@render children?.()}{/if}
    {#if footer || way}
      <div class="foot">
        {@render footer?.()}
        {#if way}
          <!-- svelte-ignore a11y_autofocus -->
          <Button variant={footer ? 'ghost' : 'primary'} size="lg" onclick={() => dialog?.close()} disabled={locked} autofocus={alert}>{way}</Button>
        {/if}
      </div>
    {/if}
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
  header { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-3); }
  /* A custom header takes the room beside the aside. It asks for at least 12rem; when
     that and the aside don't both fit, the aside moves to its own line, so a
     name is never squeezed until it breaks mid-word. */
  .custom { flex: 1 1 12rem; min-width: 0; }
  .aside { flex: none; }
  /* A custom header's name is the panel's title, so it looks like one. */
  h2, .custom :global(h2) { margin: 0; font-size: calc(var(--text-xl) * var(--size-headings)); font-family: var(--font-headings); line-height: 1.2; overflow-wrap: break-word; }
  /* Pulled up against the title (4px, where the Sheet's other parts sit 12px apart) so the
     two read as one block. */
  .lede { margin: calc(-1 * var(--space-2)) 0 0; color: var(--text-2); font-size: calc(var(--text-sm) * var(--size-app)); line-height: 1.4; }
  div.lede { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); }
  div.lede :global(p) { margin: 0; }
  /* Lays out as if the wrapper weren't there; it exists only to be pointed at. */
  .body { display: contents; }
  /* Settings one per row: each row's name above its choice, a hairline between rows but
     none above the first, so no panel has a line under its header. */
  .sheet :global(.sheet-rows > *) { display: flex; flex-direction: column; align-items: stretch; gap: var(--space-2); padding: var(--space-3) 0; border-top: 1px solid var(--line); }
  .sheet :global(.sheet-rows > :first-child) { border-top-color: transparent; }
  .sheet :global(.sheet-rows > :last-child) { padding-bottom: 0; }
  /* Every button down here is the shared Button, stretched to the panel's width: the
     finishing one, any red text link under it, then Cancel. */
  .foot { display: flex; flex-direction: column; align-items: stretch; gap: var(--space-2); margin-top: var(--space-2); }
</style>
