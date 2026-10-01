<script lang="ts">
  import { toast, dismissToast, holdToast, releaseToast } from '$lib/toast.svelte';

  /** Whether the desktop sidebar is on screen, so the toast can center over the posts beside it rather than the whole window. */
  let { sidebar = false }: { sidebar?: boolean } = $props();

  /**
   * The toast is the last thing on the page, so on a long list nobody tabbing
   * could reach its Undo before it goes. The undo shortcut everyone already
   * knows presses it instead: Cmd+Z, or Ctrl+Z off a Mac. Only for a toast
   * whose button is Undo, and never while typing in a field, where the
   * shortcut keeps its usual job of undoing what was typed.
   */
  const undoable = $derived(toast.current?.action?.label === 'Undo');
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  function keys(e: KeyboardEvent) {
    if (!undoable || e.defaultPrevented || e.key.toLowerCase() !== 'z' || e.shiftKey || e.altKey || !(mac ? e.metaKey : e.ctrlKey)) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    e.preventDefault();
    undo();
  }
  function undo() {
    toast.current?.action?.run();
    dismissToast();
  }

  /* An open Sheet sits above everything the page can stack, and the browser
     ignores clicks outside it, so an ordinary toast would land behind it and
     its Undo couldn't be pressed (and a "couldn't save" message would go
     unseen). While a Sheet is open the toast moves inside it; when that Sheet
     closes the toast moves back to the page, so a toast raised by closing
     (Unfollow does this) outlives the Sheet. */
  function onTop(el: HTMLElement, _id: number) {
    const home = el.parentElement!;
    const place = () => {
      const sheet = [...document.querySelectorAll('dialog')].filter((d) => d.matches(':modal')).pop();
      (sheet ?? home).appendChild(el);
    };
    const onClose = (e: Event) => { if ((e.target as Node).contains(el)) home.appendChild(el); };
    place();
    document.addEventListener('close', onClose, true);
    return { update: place, destroy: () => document.removeEventListener('close', onClose, true) };
  }
</script>

<svelte:window onkeydown={keys} />

{#if toast.current}
  <div class="toast" class:sidebar role="status" use:onTop={toast.current.id} onmouseenter={holdToast} onmouseleave={releaseToast} onfocusin={holdToast} onfocusout={releaseToast}>
    <span>{toast.current.message}</span>
    {#if toast.current.action}
      <button class="action" onclick={undo}>{toast.current.action.label}</button>
      <!-- Said after the message by a screen reader; there is nothing to see. -->
      {#if undoable}<span class="visually-hidden">Press {mac ? 'Command' : 'Control'} Z to undo.</span>{/if}
    {/if}
  </div>
{/if}

<style>
  .toast {
    /* Centered by its margins, not by starting at the middle: starting there left it only half the screen to fit in, so a short message wrapped on a phone. */
    position: fixed; left: 0; right: 0; margin-inline: auto; width: fit-content; bottom: calc(var(--nav-h) + var(--safe-b) + var(--space-3));
    display: flex; align-items: center; gap: var(--space-4); max-width: min(92vw, 520px);
    background: var(--text); color: var(--bg); padding: var(--space-3) var(--space-4); border-radius: var(--radius-sm);
    box-shadow: var(--shadow); font-size: calc(var(--text-base) * var(--size-app)); z-index: 50;
  }
  /* Desktop: at the top, where the reader is already looking, not the far
     edge of a tall screen. Beside the sidebar it centers over the posts; inside
     a Sheet or dialog it centers on the window, like the Sheet itself. On a
     phone it stays at the bottom, in reach of a thumb. */
  @media (min-width: 900px) {
    .toast { top: calc(env(safe-area-inset-top, 0px) + var(--space-4)); bottom: auto; }
    .toast.sidebar { left: var(--nav-w); }
    :global(dialog) .toast.sidebar { left: 0; }
  }
  /* The toast is an inverted chip, so the action word uses the toast color the
     theme picked for that ground, not the page accent (which lands on its own
     background here and disappears). */
  .action { color: var(--toast-accent); font-weight: 600; font-size: calc(var(--text-sm) * var(--size-app)); }
</style>
