<script lang="ts">
  /**
   * What an empty section says: a quiet icon above one centered line of plain
   * text, on a card like the section's items would sit on. Bookmarks uses the left menu's
   * own icon, so the section reads as the same place; Collections gets a
   * circle pile, and Activity, which has no menu row, a pulse line.
   */
  import { MENU_ICONS } from '$lib/menu-icons';

  /** Lucide's circle-pile: six small circles stacked like a pile of collected things. */
  const CIRCLE_PILE = 'M14 19a2 2 0 1 1-4 0a2 2 0 1 1 4 0M14 5a2 2 0 1 1-4 0a2 2 0 1 1 4 0M18 12a2 2 0 1 1-4 0a2 2 0 1 1 4 0M22 19a2 2 0 1 1-4 0a2 2 0 1 1 4 0M6 19a2 2 0 1 1-4 0a2 2 0 1 1 4 0M10 12a2 2 0 1 1-4 0a2 2 0 1 1 4 0';

  let { icon, text }: { icon: 'collections' | 'bookmarks' | 'activity'; text: string } = $props();
  const PATHS = { collections: CIRCLE_PILE, bookmarks: MENU_ICONS.bookmarks, activity: 'M3 12h4l3-7 4 14 3-7h4' };
</script>

<div class="empty">
  <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={PATHS[icon]} /></svg>
  <p>{text}</p>
</div>

<style>
  .empty { display: flex; flex-direction: column; align-items: center; gap: var(--space-2); padding: var(--space-5) var(--space-4); text-align: center; color: var(--text-3); background: var(--surface); border-radius: var(--radius); box-shadow: var(--shadow); }
  p { margin: 0; max-width: 40ch; color: var(--text-2); font-size: calc(var(--text-sm) * var(--size-app)); text-wrap: balance; }
</style>
