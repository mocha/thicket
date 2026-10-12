<script lang="ts">
  /**
   * The folded filters: one box that names what's chosen and opens the
   * choices in a Sheet, so a list's settings never push it down or crowd its
   * card. Drawn with the dropdown's own outline, corner and caret, so it reads
   * as something to press: an icon, its name, and what's chosen now as short
   * phrases joined by dots ("Show everyone · Added any time · Most popular").
   * Each phrase stays on one line, so a long summary breaks at the dots.
   *
   * Explore (issue #254) and Notifications (issue #274). The page owns the
   * Sheet; this only opens it.
   */
  import Dot from './Dot.svelte';
  import Icon from './Icon.svelte';

  interface Props { name?: string; summary: string[]; onclick: () => void; class?: string }
  let { name = 'Filters', summary, onclick, class: klass = '' }: Props = $props();
</script>

<button type="button" class="filters-box {klass}" {onclick} aria-haspopup="dialog">
  <svg class="icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" /></svg>
  <span class="text"><span class="name">{name}</span><span class="now">{#each summary as part, i (i)}{#if i > 0}{' '}<Dot />{' '}{/if}<span class="part">{part}</span>{/each}</span></span>
  <span class="caret"><Icon name="caret" dir="down" size={20} /></span>
</button>

<style>
  .filters-box {
    display: flex; align-items: center; gap: var(--space-3); width: 100%; min-height: 52px; text-align: left;
    padding: var(--space-2) var(--space-3); margin-bottom: var(--space-2);
    border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface);
  }
  .icon { flex: none; color: var(--accent); }
  .text { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  .name { font-weight: 600; color: var(--text); line-height: 1.25; }
  .now { font-size: calc(var(--text-sm) * var(--size-app)); color: var(--text-2); overflow-wrap: anywhere; }
  .part { white-space: nowrap; }
  .caret { flex: none; display: grid; color: var(--text-2); }
</style>
