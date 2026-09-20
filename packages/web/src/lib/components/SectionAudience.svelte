<script lang="ts">
  /**
   * "Who sees this": the audience for one part of your public profile, set
   * right on the part itself. Three steps — only you, the people you follow,
   * or anyone. It saves the moment you pick, so there is no separate save.
   * Only the owner ever sees this; a visitor sees the section or doesn't.
   */
  import type { ShareLevel } from '$lib/api';

  let { level, onchange, label }: {
    level: ShareLevel;
    onchange: (level: ShareLevel) => void;
    label: string;
  } = $props();

  const LEVELS: { value: ShareLevel; label: string }[] = [
    { value: 'private', label: 'Only me' },
    { value: 'friends', label: 'People I follow' },
    { value: 'public', label: 'Anyone' }
  ];
</script>

<div class="seg" role="radiogroup" aria-label="Who sees {label}">
  {#each LEVELS as l (l.value)}
    <button type="button" role="radio" aria-checked={level === l.value} class:on={level === l.value} onclick={() => onchange(l.value)}>{l.label}</button>
  {/each}
</div>

<style>
  .seg { display: flex; border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
  .seg button { flex: 1; padding: 7px 8px; font-size: calc(12.5px * var(--size-app)); font-weight: 600; color: var(--text-3); background: var(--surface); border-left: 1px solid var(--line); white-space: nowrap; }
  .seg button:first-child { border-left: 0; }
  .seg button.on { background: color-mix(in srgb, var(--accent) 14%, transparent); color: var(--accent); }
</style>
