<script lang="ts">
  /** Bottom sheet wrapper around CollectionCheckList. Closing is never "cancel"; every toggle already saved. */
  import CollectionCheckList from './CollectionCheckList.svelte';

  let { feedId, feedTitle, current, onchange, onclose }: {
    feedId: number; feedTitle: string; current: number[];
    onchange: (ids: number[]) => void; onclose: () => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  let ids = $state<number[]>([...current]);
  let dialog = $state<HTMLDialogElement | null>(null);
  $effect(() => { dialog?.showModal(); });
</script>

<dialog bind:this={dialog} onclose={onclose} onclick={(e) => { if (e.target === dialog) dialog?.close(); }}>
  <div class="sheet">
    <header>
      <div>
        <div class="eyebrow">Collections for</div>
        <h2>{feedTitle}</h2>
      </div>
      <button class="close" onclick={() => dialog?.close()}>Done</button>
    </header>
    <CollectionCheckList {feedId} bind:ids {onchange} />
  </div>
</dialog>

<style>
  dialog { border: 0; padding: 0; background: transparent; max-width: 100vw; max-height: 100vh; width: 100vw; height: 100vh; margin: 0; }
  dialog::backdrop { background: var(--scrim); }
  .sheet {
    position: fixed; left: 0; right: 0; bottom: 0; background: var(--surface); color: var(--text);
    border-radius: var(--radius-lg) var(--radius-lg) 0 0; padding: 16px 16px calc(16px + var(--safe-b)); max-height: 80vh; overflow: auto;
    box-shadow: var(--shadow-sheet);
  }
  @media (min-width: 700px) {
    .sheet { left: 50%; right: auto; bottom: auto; top: 50%; transform: translate(-50%, -50%); width: 420px; border-radius: var(--radius-lg); }
  }
  header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
  .eyebrow { font-size: calc(var(--text-xs) * var(--size-app)); text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-3); }
  h2 { margin: 2px 0 0; font-size: calc(var(--text-xl) * var(--size-headings)); font-family: var(--font-headings); overflow-wrap: anywhere; }
  .close { color: var(--accent); font-weight: 600; padding: 6px 4px; }
</style>
