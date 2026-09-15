<script lang="ts">
  /**
   * The page-turn controls for paged layout: a tall strip down each side of
   * the screen with one arrow in the middle. Solid when there is a page that
   * way, hollow when there is not. Also listens for the keys an e-reader's
   * hardware buttons send (PageUp/PageDown) and the arrows, as long as nothing
   * else on the page wants them.
   */
  let { canPrev, canNext, onprev, onnext, label = 'page', top = '0px', bottom = '0px', inDialog = false }: {
    canPrev: boolean; canNext: boolean; onprev: () => void; onnext: () => void; label?: string; top?: string; bottom?: string;
    /** Keys go to the pager in the open dialog when there is one, otherwise to the page behind. */
    inDialog?: boolean;
  } = $props();

  function keys(e: KeyboardEvent) {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    // Space on a focused button or link is that control's own key.
    if (e.key === ' ' && t && /^(BUTTON|A)$/.test(t.tagName)) return;
    if (!!document.querySelector('dialog[open]') !== inDialog) return;
    if (e.key === 'PageDown' || e.key === 'ArrowRight' || (e.key === ' ' && !e.shiftKey)) { if (canNext) { e.preventDefault(); onnext(); } }
    else if (e.key === 'PageUp' || e.key === 'ArrowLeft' || (e.key === ' ' && e.shiftKey)) { if (canPrev) { e.preventDefault(); onprev(); } }
  }
</script>

<svelte:window onkeydown={keys} />

<button type="button" class="turn prev" class:hollow={!canPrev} disabled={!canPrev} onclick={onprev} aria-label="Previous {label}" style:top style:bottom>
  <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
</button>
<button type="button" class="turn next" class:hollow={!canNext} disabled={!canNext} onclick={onnext} aria-label="Next {label}" style:top style:bottom>
  <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
</button>

<style>
  .turn {
    position: fixed; z-index: 30; width: var(--pager-w, 44px);
    display: grid; place-items: center; color: var(--text); -webkit-tap-highlight-color: transparent;
    background: color-mix(in srgb, var(--bg) 70%, transparent);
  }
  .prev { left: 0; border-right: 1px solid var(--line); }
  .next { right: 0; border-left: 1px solid var(--line); }
  .turn svg { background: var(--accent); color: var(--accent-ink); border-radius: 50%; padding: 4px; width: 34px; height: 34px; box-sizing: border-box; }
  .turn.hollow svg { background: transparent; color: var(--text-3); border: 2px solid var(--text-3); opacity: 0.6; }
  .turn:disabled { cursor: default; }
  .turn:not(:disabled):hover { background: color-mix(in srgb, var(--surface-2) 80%, transparent); }
  .turn:focus-visible { outline: 2px solid var(--accent); outline-offset: -3px; }
</style>
