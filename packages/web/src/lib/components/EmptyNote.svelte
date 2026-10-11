<script lang="ts">
  /**
   * What an empty section says: a quiet icon above one centered line of plain
   * text, on a card like the section's items would sit on. Collections and
   * Bookmarks use the left menu's own icons, so the section reads as the same
   * place; Activity, which has no menu row, gets Lucide's zap; a profile that shares nothing gets the crossed-out eye. A short serif
   * title over the line says it's empty, at the same size as the line. It
   * sits on a section card, so it has the same edge and inset as any other.
   */
  import Card from './Card.svelte';
  import { MENU_ICONS } from '$lib/menu-icons';

  const ZAP = 'M15.914 4a1.5 1.5 0 00-2.474-1.561l-9 9A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l9-9A1.5 1.5 0 0018.5 10h-3.997a.5.5 0 01-.472-.667z';

  /** `text` can be left out: the title alone says it. */
  let { icon, title, text }: { icon: 'collections' | 'bookmarks' | 'activity' | 'hidden'; title: string; text?: string } = $props();
  const HIDDEN = 'M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49M14.084 14.158a3 3 0 0 1-4.242-4.242M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143M2 2l20 20';
  const PATHS = { collections: MENU_ICONS.collections, bookmarks: MENU_ICONS.bookmarks, activity: ZAP, hidden: HIDDEN };
</script>

<Card kind="section" as="div" class="empty-note">
  <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={PATHS[icon]} /></svg>
  <div class="words">
    <p class="title">{title}</p>
    {#if text}<p>{text}</p>{/if}
  </div>
</Card>

<style>
  /* Global because the element is drawn by the shared Card; the class is this piece's own. */
  :global(.empty-note) { display: flex; flex-direction: column; align-items: center; gap: var(--space-2); text-align: center; color: var(--text-3); }
  .words { display: flex; flex-direction: column; gap: var(--space-1); }
  /* The same size as the line under it, bold, in the headline face. */
  .title { color: var(--text); font-family: var(--font-headings); font-weight: 700; }
  p { margin: 0; max-width: 40ch; color: var(--text-2); font-size: calc(var(--text-sm) * var(--size-app)); text-wrap: balance; }
</style>
