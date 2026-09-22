<script lang="ts">
  /**
   * The color themes, as swatches: page, card, text and accent of each, in
   * whichever half (light or dark) the screen is showing right now. High
   * contrast grows a second row for its accent, because that is the one theme
   * where the accent is a separate choice.
   */
  import { display, setDisplay, PALETTES, ACCENTS, type Palette, type Accent } from '$lib/display.svelte';
  import { api } from '$lib/api';
  import ChoiceGroup from '$lib/components/ChoiceGroup.svelte';
  import { SWATCHES, ACCENT_HEX } from '$lib/generated/palette-swatches';

  /** Which half the screen is in: the explicit choice, else the device. Tracks the device while "match my device" is on. */
  let deviceDark = $state(false);
  $effect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    deviceDark = mq.matches;
    const on = (e: MediaQueryListEvent) => (deviceDark = e.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  });
  const half = $derived<'light' | 'dark'>(display.appearance === 'system' ? (deviceDark ? 'dark' : 'light') : display.appearance);

  function choose(p: Palette) { setDisplay({ palette: p }); api.event('display_changed', { key: 'palette', value: p }); }
  function chooseAccent(a: Accent) { setDisplay({ accent: a }); api.event('display_changed', { key: 'accent', value: a }); }
  /* Each accent shows its own color, in whichever half the screen is in. */
  const accentOptions = $derived(ACCENTS.map((a) => ({ value: a.id, label: a.label, swatch: ACCENT_HEX[a.id][half] })));
</script>

<div class="palettes" role="radiogroup" aria-label="Color theme">
  {#each PALETTES as p (p.id)}
    {@const s = SWATCHES[p.id][half]}
    {@const hard = p.id === 'contrast' || p.id === 'mono'}
    <button type="button" role="radio" aria-checked={display.palette === p.id} class:on={display.palette === p.id} onclick={() => choose(p.id)} title={p.note}>
      <span class="sw" style="--sw-bg:{s.bg};--sw-surface:{s.surface};--sw-text:{s.text};--sw-accent:{p.id === 'contrast' ? ACCENT_HEX[display.accent][half] : s.accent}" class:hard aria-hidden="true">
        <span class="card"><i class="t"></i><i class="t short"></i><i class="a"></i></span>
      </span>
      <span class="label">{p.label}</span>
    </button>
  {/each}
</div>
{#if display.palette === 'contrast'}
  <div class="accents">
    <span class="lead">Accent</span>
    <ChoiceGroup
      options={accentOptions}
      value={display.accent}
      label="Accent color"
      size="sm"
      onchange={(v) => chooseAccent(v as Accent)}
    />
  </div>
{/if}

<style>
  .palettes { display: grid; grid-template-columns: repeat(auto-fill, minmax(92px, 1fr)); gap: 8px; }
  .palettes button {
    display: flex; flex-direction: column; gap: 6px; padding: 6px; border-radius: 12px;
    border: 1px solid var(--line); background: var(--bg); color: var(--text); text-align: left;
  }
  .palettes button:hover { border-color: var(--text-3); }
  .palettes button.on { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
  .palettes button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .sw { display: block; aspect-ratio: 5 / 3; border-radius: 8px; background: var(--sw-bg); padding: 7px 8px 0; overflow: hidden; border: 1px solid rgba(128, 128, 128, 0.18); }
  .card { display: flex; flex-direction: column; gap: 4px; height: 100%; padding: 6px 7px; border-radius: 5px 5px 0 0; background: var(--sw-surface); box-shadow: 0 1px 3px rgba(0,0,0,0.12); }
  .hard .card { box-shadow: none; border: 1px solid var(--sw-text); border-bottom: 0; }
  .t { display: block; height: 3px; border-radius: 2px; background: var(--sw-text); opacity: 0.85; }
  .t.short { width: 60%; opacity: 0.45; }
  .a { display: block; width: 34%; height: 5px; border-radius: 3px; background: var(--sw-accent); margin-top: 2px; }
  .label { font-size: calc(var(--text-sm) * var(--size-app)); font-weight: 600; padding: 0 2px; }
  .on .label { color: var(--accent); }

  .accents { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 10px; }
  .lead { font-size: calc(var(--text-sm) * var(--size-app)); font-weight: 600; color: var(--text-2); margin-right: 4px; }
  /* On a narrow screen the row drops below the word "Accent" rather than being squeezed. */
  .accents :global(.cg) { flex: none; }
</style>
