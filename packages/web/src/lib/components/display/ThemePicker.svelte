<script lang="ts">
  /**
   * The colour themes, as swatches: page, card, text and accent of each, in
   * whichever half (light or dark) the screen is showing right now. High
   * contrast grows a second row for its accent, because that is the one theme
   * where the accent is a separate choice.
   */
  import { display, setDisplay, PALETTES, ACCENTS, type Palette, type Accent } from '$lib/display.svelte';
  import { api } from '$lib/api';

  type Sw = { bg: string; surface: string; text: string; accent: string };
  const SWATCHES: Record<Palette, { light: Sw; dark: Sw }> = {
    default: { light: { bg: '#f6f1e8', surface: '#fffdf9', text: '#1d1a14', accent: '#2f5d3a' }, dark: { bg: '#16140f', surface: '#1f1c15', text: '#efe9dc', accent: '#7fb08a' } },
    kingfisher: { light: { bg: '#eef3f7', surface: '#ffffff', text: '#10202e', accent: '#0b5fa5' }, dark: { bg: '#0d161f', surface: '#142030', text: '#e6eef6', accent: '#5fb3ff' } },
    slate: { light: { bg: '#eceff2', surface: '#f8f9fb', text: '#1f262d', accent: '#3f5f7a' }, dark: { bg: '#15191e', surface: '#1c2229', text: '#dfe5eb', accent: '#8fb0c9' } },
    ember: { light: { bg: '#fbf4ec', surface: '#fffaf4', text: '#23170f', accent: '#b93c0a' }, dark: { bg: '#1a120c', surface: '#241a12', text: '#f4e9dc', accent: '#ff8a4c' } },
    parchment: { light: { bg: '#eadfcb', surface: '#f2e9d8', text: '#4a3b2a', accent: '#7a5535' }, dark: { bg: '#26211a', surface: '#2d2820', text: '#cfc2ad', accent: '#c09a6b' } },
    graphite: { light: { bg: '#f0f0ef', surface: '#fafaf9', text: '#1c1c1c', accent: '#465a7c' }, dark: { bg: '#161616', surface: '#1e1e1e', text: '#e8e8e6', accent: '#9db0d0' } },
    fog: { light: { bg: '#e6e7e6', surface: '#ededec', text: '#3f4241', accent: '#556a67' }, dark: { bg: '#202322', surface: '#272a29', text: '#c4c8c6', accent: '#8fa6a2' } },
    contrast: { light: { bg: '#ffffff', surface: '#ffffff', text: '#000000', accent: '#0050a0' }, dark: { bg: '#000000', surface: '#000000', text: '#ffffff', accent: '#7db8ff' } },
    mono: { light: { bg: '#ffffff', surface: '#ffffff', text: '#000000', accent: '#000000' }, dark: { bg: '#000000', surface: '#000000', text: '#ffffff', accent: '#ffffff' } }
  };
  const ACCENT_HEX: Record<Accent, { light: string; dark: string }> = {
    blue: { light: '#0050a0', dark: '#7db8ff' }, orange: { light: '#a24c00', dark: '#ffb454' }, green: { light: '#006a4e', dark: '#4fd1a5' }, purple: { light: '#7a2d8a', dark: '#e19bea' }
  };

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
</script>

<div class="palettes" role="radiogroup" aria-label="Colour theme">
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
  <div class="accents" role="radiogroup" aria-label="Accent colour">
    <span class="lead">Accent</span>
    {#each ACCENTS as a (a.id)}
      <button type="button" role="radio" aria-checked={display.accent === a.id} class:on={display.accent === a.id} onclick={() => chooseAccent(a.id)}>
        <i style="background:{ACCENT_HEX[a.id][half]}" aria-hidden="true"></i>{a.label}
      </button>
    {/each}
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
  .palettes button:focus-visible, .accents button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .sw { display: block; aspect-ratio: 5 / 3; border-radius: 8px; background: var(--sw-bg); padding: 7px 8px 0; overflow: hidden; border: 1px solid rgba(128, 128, 128, 0.18); }
  .card { display: flex; flex-direction: column; gap: 4px; height: 100%; padding: 6px 7px; border-radius: 5px 5px 0 0; background: var(--sw-surface); box-shadow: 0 1px 3px rgba(0,0,0,0.12); }
  .hard .card { box-shadow: none; border: 1px solid var(--sw-text); border-bottom: 0; }
  .t { display: block; height: 3px; border-radius: 2px; background: var(--sw-text); opacity: 0.85; }
  .t.short { width: 60%; opacity: 0.45; }
  .a { display: block; width: 34%; height: 5px; border-radius: 3px; background: var(--sw-accent); margin-top: 2px; }
  .label { font-size: 12.5px; font-weight: 600; padding: 0 2px; }
  .on .label { color: var(--accent); }

  .accents { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 10px; }
  .lead { font-size: 13px; font-weight: 600; color: var(--text-2); margin-right: 4px; }
  .accents button { display: inline-flex; align-items: center; gap: 7px; padding: 6px 12px 6px 7px; border-radius: 999px; border: 1px solid var(--line); background: var(--bg); font-size: 13px; font-weight: 600; color: var(--text-2); }
  .accents button.on { border-color: var(--accent); color: var(--text); box-shadow: inset 0 0 0 1px var(--accent); }
  .accents i { width: 16px; height: 16px; border-radius: 50%; border: 1px solid rgba(128,128,128,0.25); }
</style>
