<script lang="ts">
  /**
   * The Sheet: a panel for one focused task. On a phone it rises from the
   * bottom of the screen; from 700px up it sits centered. A title and a close
   * button along the top, the task's content in the middle, and an optional
   * `footer` pinned at the bottom for the one action that finishes the task
   * (give that button the `sheet-action` class for the big full-width look).
   *
   * The content column never grows past the screen: any part of it that can
   * scroll (a long list) should say so with its own overflow, and everything
   * else keeps its height. When even that doesn't fit (the keyboard is up, or
   * the phone is on its side) the whole Sheet scrolls, so the footer's action
   * can always be reached. Tapping the dimmed backdrop closes it, as does
   * Escape. The parent opens it with `dialog.showModal()`.
   */
  import type { Snippet } from 'svelte';
  import IconButton from './IconButton.svelte';

  let { title, dialog = $bindable(null), onclose, children, footer }: {
    title: string; dialog?: HTMLDialogElement | null; onclose?: () => void; children: Snippet; footer?: Snippet;
  } = $props();
  const titleId = $props.id();
</script>

<dialog bind:this={dialog} {onclose} onclick={(e) => { if (e.target === dialog) dialog?.close(); }} aria-labelledby={titleId}>
  <div class="sheet">
    <header>
      <h2 id={titleId}>{title}</h2>
      <IconButton icon="close" label="Close" onclick={() => dialog?.close()} />
    </header>
    {@render children()}
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
  h2 { margin: 0; font-size: calc(var(--text-xl) * var(--size-headings)); font-family: var(--font-headings); overflow-wrap: anywhere; }
  .foot { display: flex; flex-direction: column; gap: var(--space-2); margin-top: var(--space-2); }
  .foot :global(.sheet-action) { padding: var(--space-4); border-radius: var(--radius-md); background: var(--accent); color: var(--accent-ink); font-weight: 600; font-size: calc(var(--text-base) * var(--size-app)); }
  .foot :global(.sheet-action:disabled) { opacity: 0.5; }
</style>
