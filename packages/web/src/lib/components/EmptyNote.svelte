<script lang="ts">
  /**
   * What an empty section says: a quiet icon above one centered line of plain
   * text, on a card like the section's items would sit on. Bookmarks uses the left menu's
   * own icon, so the section reads as the same place; Collections gets a
   * circle pile, and Activity, which has no menu row, a zap. A short serif
   * title over the line says it's empty, at the same size as the line.
   */
  import { MENU_ICONS } from '$lib/menu-icons';

  /** Lucide's circle-pile: six small circles stacked like a pile of collected things. */
  /** Lucide's zap. */
  const ZAP = 'M15.914 4a1.5 1.5 0 00-2.474-1.561l-9 9A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l9-9A1.5 1.5 0 0018.5 10h-3.997a.5.5 0 01-.472-.667z';
  const CIRCLE_PILE = 'M14 19a2 2 0 1 1-4 0a2 2 0 1 1 4 0M14 5a2 2 0 1 1-4 0a2 2 0 1 1 4 0M18 12a2 2 0 1 1-4 0a2 2 0 1 1 4 0M22 19a2 2 0 1 1-4 0a2 2 0 1 1 4 0M6 19a2 2 0 1 1-4 0a2 2 0 1 1 4 0M10 12a2 2 0 1 1-4 0a2 2 0 1 1 4 0';

  let { icon, title, text }: { icon: 'collections' | 'bookmarks' | 'activity'; title: string; text: string } = $props();
  const PATHS = { collections: CIRCLE_PILE, bookmarks: MENU_ICONS.bookmarks, activity: ZAP };
</script>

<div class="empty">
  <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={PATHS[icon]} /></svg>
  <div class="words">
    <p class="title">{title}</p>
    <p>{text}</p>
  </div>
</div>

<style>
  .empty { display: flex; flex-direction: column; align-items: center; gap: var(--space-2); padding: var(--space-5) var(--space-4); text-align: center; color: var(--text-3); background: var(--surface); border-radius: var(--radius); box-shadow: var(--shadow); }
  .words { display: flex; flex-direction: column; gap: var(--space-1); }
  /* The same size as the line under it, bold, in the headline face. */
  .title { color: var(--text); font-family: var(--font-headings); font-weight: 700; }
  p { margin: 0; max-width: 40ch; color: var(--text-2); font-size: calc(var(--text-sm) * var(--size-app)); text-wrap: balance; }
</style>
