<script lang="ts">
  /**
   * The tour's Collections picture: a loose scatter of feeds sorts itself into
   * two collections, Cooking and Tech, then Cooking is shared and someone's
   * copy of it slides out below.
   */
  import { MENU_ICONS } from '$lib/menu-icons';
  import Monogram from '$lib/components/Monogram.svelte';
  import SceneLoop from './SceneLoop.svelte';

  /* Where each feed starts in the scatter, as an offset from where it lands. */
  const GROUPS = [
    { name: 'Cooking', feeds: [
      { site: 'Slow Kitchen', dx: 70, dy: 40, r: -6 },
      { site: 'Bread Notes', dx: 150, dy: -10, r: 5 },
      { site: 'Market Day', dx: 30, dy: 70, r: 8 }
    ] },
    { name: 'Tech', feeds: [
      { site: 'Byte Size', dx: -140, dy: 30, r: 7 },
      { site: 'Shell Tips', dx: -60, dy: 60, r: -5 },
      { site: 'Chip Talk', dx: -170, dy: -20, r: -8 }
    ] }
  ];
</script>

{#snippet icon(d: string)}<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path {d} /></svg>{/snippet}

<SceneLoop round={7000}>
  <div class="wrap">
    <div class="pair">
      {#each GROUPS as g, gi (g.name)}
        <div class="col">
          <p class="head">{@render icon(MENU_ICONS.collections)}<span>{g.name}</span>{#if gi === 0}<span class="share">Share</span>{/if}</p>
          {#each g.feeds as f, i (f.site)}
            <div class="feed" style:--dx="{f.dx}px" style:--dy="{f.dy}px" style:--r="{f.r}deg" style:--at="{450 + (gi + i * 2) * 110}ms">
              <Monogram name={f.site} size={16} /><span>{f.site}</span>
            </div>
          {/each}
        </div>
      {/each}
    </div>
    <div class="copy">
      <Monogram name="Priya" size={18} />
      <span class="copied">{@render icon(MENU_ICONS.collections)}<strong>Cooking</strong> copied by Priya</span>
    </div>
  </div>
</SceneLoop>

<style>
  .wrap { padding: var(--space-5) var(--space-4) 0; display: flex; flex-direction: column; align-items: center; gap: var(--space-3); }
  .pair { display: grid; grid-template-columns: repeat(2, minmax(0, 190px)); gap: var(--space-3); width: 100%; justify-content: center; }

  /* The collections' frames and names come in once the feeds are mostly sorted. */
  .col { background: var(--surface); border-radius: var(--radius-sm); box-shadow: var(--shadow); border: var(--card-border, 0); padding: var(--space-2) var(--space-3) var(--space-3); display: flex; flex-direction: column; gap: 6px; animation: frame 420ms ease-out 1300ms backwards; }
  @keyframes frame { from { background: transparent; box-shadow: none; border-color: transparent; } }
  .head { display: flex; align-items: center; gap: 6px; margin: 0 0 2px; font-size: 12px; font-weight: 600; color: var(--text); animation: fade 360ms ease-out 1400ms backwards; }
  .head svg { color: var(--text-2); }
  .share { margin-left: auto; padding: 1px 8px; border-radius: var(--radius-pill); font-size: 10px; background: var(--surface-2); color: var(--text-2); animation: tap 500ms ease-out 2500ms backwards; }
  @keyframes tap { from { background: var(--accent); color: var(--accent-ink); } }

  /* Each feed flies from the scatter into its collection. */
  .feed {
    display: flex; align-items: center; gap: 6px; padding: 4px 6px; border-radius: 6px; background: var(--surface-2);
    font-size: 11px; font-weight: 600; color: var(--text); white-space: nowrap; overflow: hidden;
    animation: settle 700ms cubic-bezier(0.2, 0.8, 0.2, 1) var(--at) backwards;
  }
  .feed span { overflow: hidden; text-overflow: ellipsis; }
  @keyframes settle { from { transform: translate(var(--dx), var(--dy)) rotate(var(--r)); box-shadow: var(--shadow); } }

  /* Shared: someone's copy slides out from under Cooking. */
  .copy {
    display: flex; align-items: center; gap: var(--space-2); padding: 6px var(--space-3) 6px 6px; border-radius: var(--radius-pill);
    background: var(--surface); box-shadow: var(--shadow); border: var(--card-border, 0); font-size: 11px; color: var(--text-2);
    animation: out 600ms cubic-bezier(0.2, 0.8, 0.2, 1) 2900ms backwards;
  }
  .copied { display: inline-flex; align-items: center; gap: 4px; }
  .copied strong { color: var(--text); }
  @keyframes out { from { opacity: 0; transform: translate(-70px, -40px) scale(0.85); } }
  @keyframes fade { from { opacity: 0; } }
</style>
