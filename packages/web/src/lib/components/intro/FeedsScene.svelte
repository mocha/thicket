<script lang="ts">
  /**
   * The tour's Add new feed and Explore picture, side by side as the two ways
   * in: on the left a web address types itself in and the site is followed; on
   * the right, feeds other readers follow drift up and one gets followed.
   */
  import { MENU_ICONS } from '$lib/menu-icons';
  import Monogram from '$lib/components/Monogram.svelte';
  import SceneLoop from './SceneLoop.svelte';
  import Swap from './Swap.svelte';

  const EXPLORE = [
    { site: 'Crumb', readers: '41 readers' },
    { site: 'Tides', readers: '28 readers', follow: true },
    { site: 'Sprout', readers: '17 readers' }
  ];
</script>

{#snippet head(icon: string, label: string, accent = false)}
  <p class="head" class:accent><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width={accent ? 1.5 : 2} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={icon} /></svg>{label}</p>
{/snippet}

<SceneLoop round={6500}>
  <div class="pair">
    <div class="panel">
      {@render head(MENU_ICONS.addFeed, 'Add new feed', true)}
      <div class="field"><span class="typed">slowkitchen.blog</span></div>
      <div class="found">
        <Monogram name="Slow Kitchen" size={16} /><span class="site">Slow Kitchen</span>
        <span class="pill on">Following</span>
      </div>
    </div>
    <div class="panel">
      {@render head(MENU_ICONS.explore, 'Explore')}
      {#each EXPLORE as f, i (f.site)}
        <div class="feed" style:--at="{300 + i * 140}ms">
          <Monogram name={f.site} size={16} />
          <span class="names"><span class="site">{f.site}</span><span class="readers">{f.readers}</span></span>
          {#if f.follow}<span class="pill on late"><Swap from="Follow" to="Following" at={2900} /></span>{:else}<span class="pill">Follow</span>{/if}
        </div>
      {/each}
    </div>
  </div>
</SceneLoop>

<style>
  .pair { display: grid; grid-template-columns: repeat(2, minmax(0, 210px)); gap: var(--space-3); justify-content: center; padding: var(--space-5) var(--space-4) 0; }
  .panel { container-type: inline-size; background: var(--surface); border-radius: var(--radius-sm); box-shadow: var(--shadow); border: var(--card-border, 0); padding: var(--space-3); display: flex; flex-direction: column; gap: var(--space-2); }
  .head { display: flex; align-items: center; gap: 6px; margin: 0 0 var(--space-1); font-size: 12px; font-weight: 600; color: var(--text); }
  .head svg { color: var(--text-2); }
  .head.accent, .head.accent svg { color: var(--accent); }
  .site { font-size: 11px; font-weight: 600; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pill { margin-left: auto; flex: none; padding: 2px 8px; border-radius: var(--radius-pill); font-size: 10px; font-weight: 600; background: var(--surface-2); color: var(--text-2); }
  .pill.on { background: var(--accent); color: var(--accent-ink); }

  /* The address types itself in, a letter at a time, with a caret that goes once it's done. */
  .field { border: 1px solid var(--line); border-radius: 6px; padding: 5px 8px; font-size: 11px; color: var(--text); background: var(--bg); }
  .typed {
    display: inline-block; vertical-align: bottom; max-width: 16ch; overflow: hidden; white-space: nowrap;
    border-right: 1px solid transparent;
    animation: type 1100ms steps(16) 500ms backwards, caret 1700ms steps(1) backwards;
  }
  @keyframes type { from { max-width: 0; } }
  @keyframes caret { from { border-right-color: var(--text); } }
  .found { display: flex; align-items: center; gap: 6px; animation: rise 420ms cubic-bezier(0.2, 0.8, 0.2, 1) 1900ms backwards; }

  .feed { display: flex; align-items: center; gap: 6px; animation: rise 420ms cubic-bezier(0.2, 0.8, 0.2, 1) var(--at) backwards; }
  .names { display: flex; flex-direction: column; min-width: 0; line-height: 1.2; }
  .readers { font-size: 10px; color: var(--text-2); }
  .late { animation: press 260ms ease-out 2900ms backwards; }
  @keyframes press { from { background: var(--surface-2); color: var(--text-2); transform: scale(0.92); } }
  /* A phone's narrow panels: the reader counts go, and the result's Following drops under its name. */
  @container (max-width: 200px) {
    .readers { display: none; }
    .found { flex-wrap: wrap; row-gap: 4px; }
    .found .pill { margin-left: 22px; }
  }
  @keyframes rise { from { opacity: 0; transform: translateY(8px); } }
</style>
