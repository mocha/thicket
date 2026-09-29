<script lang="ts">
  /**
   * The color themes, as tiles: each picture is that theme's page, card, text
   * and accent, in whichever half (light or dark) the screen is showing right
   * now, and each tile says who the theme is for. Crisp grows a second
   * row for its accent, because that is the one theme where the accent is a
   * separate choice.
   */
  import { display, setDisplay, PALETTES, ACCENTS, type Palette, type Accent } from '$lib/display.svelte';
  import { api } from '$lib/api';
  import ChoiceGroup from '$lib/components/ChoiceGroup.svelte';
  import Tiles from './Tiles.svelte';
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

  /* A tiny page with a card floating on it, in the theme's own colors. The two
     hard-edged themes outline the card in ink instead of lifting it with a shadow. */
  function swatch(id: Palette): string {
    const s = SWATCHES[id][half];
    const accent = id === 'contrast' ? ACCENT_HEX[display.accent][half] : s.accent;
    const hard = id === 'contrast' || id === 'mono';
    const card = hard
      ? `<rect x="6.5" y="6.5" width="37" height="26" rx="2" fill="${s.surface}" stroke="${s.text}" stroke-width="0.8"/>`
      : `<rect x="6" y="7" width="38" height="26" rx="2" fill="#000" opacity="0.08"/><rect x="6" y="6" width="38" height="26" rx="2" fill="${s.surface}"/>`;
    return `<svg viewBox="0 0 50 30" xmlns="http://www.w3.org/2000/svg"><rect width="50" height="30" fill="${s.bg}"/>${card}` +
      `<rect x="11" y="11" width="26" height="1.8" rx="0.9" fill="${s.text}" opacity="0.85"/>` +
      `<rect x="11" y="15" width="16" height="1.8" rx="0.9" fill="${s.text}" opacity="0.45"/>` +
      `<rect x="11" y="20" width="12" height="3" rx="1.5" fill="${accent}"/>` +
      `<rect x="0.5" y="0.5" width="49" height="29" rx="2" fill="none" stroke="var(--swatch-border)" stroke-width="0.6"/></svg>`;
  }
  const art = $derived(Object.fromEntries(PALETTES.map((p) => [p.id, swatch(p.id)])) as Record<Palette, string>);

  function choose(p: Palette) { setDisplay({ palette: p }); api.event('display_changed', { key: 'palette', value: p }); }
  function chooseAccent(a: Accent) { setDisplay({ accent: a }); api.event('display_changed', { key: 'accent', value: a }); }
  /* Each accent shows its own color, in whichever half the screen is in. */
  const accentOptions = $derived(ACCENTS.map((a) => ({ value: a.id, label: a.label, swatch: ACCENT_HEX[a.id][half] })));
</script>

<Tiles name="Color theme" options={PALETTES} value={display.palette} {art} notes onchange={choose} />
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
  .accents { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); margin-top: var(--space-3); }
  .lead { font-size: calc(var(--text-sm) * var(--size-app)); font-weight: 600; color: var(--text-2); margin-right: var(--space-1); }
  /* On a narrow screen the row drops below the word "Accent" rather than being squeezed. */
  .accents :global(.cg) { flex: none; }
</style>
