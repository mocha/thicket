<script lang="ts" generics="T extends string">
  /**
   * A row of illustrated choices standing in for a radio group. The picture
   * does the explaining; the label names it; the note (optional, settings
   * page only) says what it means. Illustrations are drawn in the live tokens
   * so they always show the current palette.
   */
  let { options, value, onchange, art, notes = false, name }: {
    options: { id: T; label: string; note: string }[];
    value: T;
    onchange: (id: T) => void;
    /** Inline SVG markup per option. Static, ours, never user content. */
    art: Record<T, string>;
    notes?: boolean;
    name: string;
  } = $props();
</script>

<div class="tiles" role="radiogroup" aria-label={name}>
  {#each options as o (o.id)}
    <button type="button" role="radio" aria-checked={value === o.id} class:on={value === o.id} onclick={() => onchange(o.id)}>
      <span class="art" aria-hidden="true">{@html art[o.id]}</span>
      <span class="label">{o.label}</span>
      {#if notes}<span class="note">{o.note}</span>{/if}
    </button>
  {/each}
</div>

<style>
  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 8px; }
  button {
    display: flex; flex-direction: column; align-items: stretch; gap: 8px; text-align: left;
    padding: 10px; border-radius: 12px; border: 1px solid var(--line); background: var(--bg); color: var(--text);
  }
  button:hover { border-color: var(--text-3); }
  button.on { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .art { display: block; aspect-ratio: 5 / 3; border-radius: 8px; overflow: hidden; background: var(--surface-2); }
  .art :global(svg) { display: block; width: 100%; height: 100%; }
  .label { font-size: 14px; font-weight: 600; }
  .on .label { color: var(--accent); }
  .note { font-size: 12.5px; color: var(--text-3); line-height: 1.35; }
</style>
