<script lang="ts">
  /**
   * One setting and what it's set to: the name, its current choice in quieter
   * text, and, when it can be opened, an arrow at the far end. Rows stack with
   * a hairline between them, so a few in a row read as one list. Given
   * `onclick`, the whole row is the button (a 44px-plus tap target); without
   * it, the row only states the value, as the saved-settings offer does.
   */
  import Icon from './Icon.svelte';

  let { label, value, onclick, ...rest }: { label: string; value: string; onclick?: () => void; [key: string]: unknown } = $props();
</script>

{#if onclick}
  <button type="button" class="row" {onclick} {...rest}>
    <span class="label">{label}</span>
    <span class="value">{value}</span>
    <Icon name="caret" size={16} class="arrow" />
  </button>
{:else}
  <div class="row" {...rest}>
    <span class="label">{label}</span>
    <span class="value">{value}</span>
  </div>
{/if}

<style>
  .row {
    display: flex; align-items: center; gap: var(--space-3); width: 100%; min-height: 48px;
    padding: var(--space-3) 0; border: 0; border-bottom: 1px solid var(--line); background: none;
    font: inherit; font-size: calc(var(--text-base) * var(--size-app)); color: var(--text); text-align: left;
  }
  .row:first-child { border-top: 1px solid var(--line); }
  /* The last row ends the list without a line of its own; whatever follows sets its own edge. */
  .row:last-child { border-bottom: 0; }
  button.row { cursor: pointer; }
  button.row:hover .label { color: var(--accent); }
  button.row:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: var(--radius-sm); }
  .label { flex: none; width: 9.5em; font-weight: 600; }
  .value { flex: 1; min-width: 0; color: var(--text-2); }
  .row :global(.arrow) { flex: none; color: var(--text-2); }
  /* A phone has no room for the two side by side: the choice goes under the name. */
  @media (max-width: 480px) {
    .row { flex-wrap: wrap; row-gap: 2px; }
    .label { width: auto; flex: 1; }
    .value { order: 3; flex-basis: 100%; font-size: calc(var(--text-sm) * var(--size-app)); }
  }
</style>
