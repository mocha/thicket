<script lang="ts">
  import IconButton from './IconButton.svelte';

  /**
   * The page-turn controls for paged layout: a tall strip down each side of
   * the screen with a bordered arrow button in the middle. The whole strip
   * turns the page; the arrow dims when there is no page that way. Also
   * listens for the keys an e-reader's hardware buttons send (PageUp/PageDown)
   * and the arrows, as long as nothing else on the page wants them.
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

<div class="turn prev" class:off={!canPrev} style:top style:bottom>
  <IconButton icon="caret" dir="left" variant="bordered" stretch disabled={!canPrev} onclick={onprev} label="Previous {label}" />
</div>
<div class="turn next" class:off={!canNext} style:top style:bottom>
  <IconButton icon="caret" dir="right" variant="bordered" stretch disabled={!canNext} onclick={onnext} label="Next {label}" />
</div>

<style>
  .turn {
    position: fixed; z-index: 30; width: var(--pager-w, 44px);
    display: grid; place-items: center; -webkit-tap-highlight-color: transparent;
    background: color-mix(in srgb, var(--bg) 70%, transparent);
  }
  .prev { left: 0; border-right: 1px solid var(--line); }
  .next { right: 0; border-left: 1px solid var(--line); }
  .turn:not(.off):hover { background: color-mix(in srgb, var(--surface-2) 80%, transparent); }
</style>
