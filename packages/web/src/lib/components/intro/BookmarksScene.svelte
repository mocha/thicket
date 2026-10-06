<script lang="ts">
  /**
   * The tour's Bookmarks picture: a post's bookmark fills in, a note writes
   * itself underneath in the note's own look, and below it the choice of who
   * sees your notes moves from Anyone to People I follow.
   */
  import { MENU_ICONS } from '$lib/menu-icons';
  import SceneLoop from './SceneLoop.svelte';
  import MiniCard from './MiniCard.svelte';
  import MiniChoice from './MiniChoice.svelte';
</script>

{#snippet mark()}
  <svg class="mark" viewBox="0 0 24 24" width="16" height="16" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={MENU_ICONS.bookmarks} /></svg>
{/snippet}

<SceneLoop round={7500}>
  <div class="wrap">
    <MiniCard site="Slow Kitchen" time="2 hr" title="Ginger soup in 30 minutes" end={mark}>
      <div class="note">
        <p class="who">Your note</p>
        <p class="body"><span class="typed">Made this tonight. More ginger next time.</span></p>
      </div>
    </MiniCard>
    <div class="who-sees">
      <span class="label">Who sees your notes</span>
      <MiniChoice from="Anyone" to="People I follow" at={3900} />
    </div>
  </div>
</SceneLoop>

<style>
  .wrap { width: min(360px, 88%); margin: 0 auto; padding-top: var(--space-5); display: flex; flex-direction: column; gap: var(--space-3); }

  /* The bookmark fills, with a small pop. */
  .wrap :global(.mark) { fill: var(--accent); stroke: var(--accent); animation: fill 360ms cubic-bezier(0.3, 1.6, 0.5, 1) 600ms backwards; }
  @keyframes fill { from { fill: transparent; stroke: var(--text-2); transform: scale(0.8); } }

  /* The note opens under the post, then its words type in. */
  .note { box-sizing: border-box; height: 58px; overflow: hidden; border-top: 1px solid var(--line); padding: var(--space-2) var(--space-3); animation: open 360ms cubic-bezier(0.2, 0.8, 0.2, 1) 1200ms backwards; }
  @keyframes open { from { height: 0; padding-top: 0; padding-bottom: 0; } }
  .note p { margin: 0; }
  .who { font-size: 10px; font-weight: 600; color: var(--text-2); margin-bottom: 2px !important; }
  .body { font-size: 12px; color: var(--text); padding-left: var(--space-2); border-left: 2px solid var(--line); white-space: nowrap; }
  .typed { display: inline-block; vertical-align: bottom; max-width: 42ch; overflow: hidden; animation: type 1400ms steps(41) 1600ms backwards; }
  @keyframes type { from { max-width: 0; } }

  /* Who sees your notes: the choice moves from Anyone to People I follow. */
  .who-sees { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); flex-wrap: wrap; animation: rise 420ms cubic-bezier(0.2, 0.8, 0.2, 1) 3100ms backwards; }
  .label { font-size: 11px; font-weight: 600; color: var(--text); }
  @keyframes rise { from { opacity: 0; transform: translateY(8px); } }
</style>
