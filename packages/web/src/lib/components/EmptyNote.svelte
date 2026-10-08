<script lang="ts">
  /**
   * What an empty section says: a quiet icon above one centered line of plain
   * text, with no card around it. Collections and Bookmarks use the left
   * menu's own icons, so the section reads as the same place; Activity, which
   * has no menu row, gets a pulse line.
   */
  import { MENU_ICONS } from '$lib/menu-icons';

  let { icon, text }: { icon: 'collections' | 'bookmarks' | 'activity'; text: string } = $props();
  const PATHS = { collections: MENU_ICONS.collections, bookmarks: MENU_ICONS.bookmarks, activity: 'M3 12h4l3-7 4 14 3-7h4' };
</script>

<div class="empty">
  <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={PATHS[icon]} /></svg>
  <p>{text}</p>
</div>

<style>
  .empty { display: flex; flex-direction: column; align-items: center; gap: var(--space-2); padding: var(--space-4) var(--space-4) var(--space-2); text-align: center; color: var(--text-3); }
  p { margin: 0; max-width: 40ch; color: var(--text-2); font-size: calc(var(--text-sm) * var(--size-app)); text-wrap: balance; }
</style>
