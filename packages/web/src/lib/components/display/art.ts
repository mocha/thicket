/**
 * The little pictures on the display choices. Each is a 50×30 window drawn in
 * the live tokens, so they repaint with the palette. Inline SVG strings, ours.
 */
import type { Palette, Accent } from '$lib/display.svelte';
import { SWATCHES, ACCENT_HEX, type Sw } from '$lib/generated/palette-swatches';

const frame = (inner: string, bg = 'var(--surface)') =>
  `<svg viewBox="0 0 50 30" xmlns="http://www.w3.org/2000/svg"><rect width="50" height="30" fill="${bg}"/>${inner}</svg>`;

/** Mix two #rrggbb colors, `t` of the first. */
const blend = (a: string, b: string, t: number) =>
  '#' + [1, 3, 5].map((i) => Math.round(parseInt(a.slice(i, i + 2), 16) * t + parseInt(b.slice(i, i + 2), 16) * (1 - t)).toString(16).padStart(2, '0')).join('');

const lines = (x: number, y: number, w: number, color: string, n = 3, gap = 3) =>
  Array.from({ length: n }, (_, i) => `<rect x="${x}" y="${y + i * gap}" width="${i === n - 1 ? w * 0.6 : w}" height="1.4" rx="0.7" fill="${color}"/>`).join('');

/**
 * Light, dark and "match my device", drawn in the current theme's own light
 * and dark colors, not the live ones: the live ones belong to whichever half
 * the screen is in, so a white moon from a dark theme would vanish on the
 * light picture's page.
 */
export function appearanceArt(palette: Palette, accent: Accent) {
  const pick = (half: 'light' | 'dark') => {
    const s = SWATCHES[palette][half];
    return { ...s, accent: palette === 'contrast' ? ACCENT_HEX[accent][half] : s.accent };
  };
  const l = pick('light'), d = pick('dark');
  /* The lines are the theme's text, faded 55% toward its page. */
  const ink = (s: Sw) => blend(s.text, s.bg, 0.45);
  const sun = (cx: number, r: number, s: Sw) => `<circle cx="${cx}" cy="12" r="${r}" fill="${s.accent}"/>`;
  const moon = (path: string, s: Sw) => `<path d="${path}" fill="${s.accent}"/>`;
  return {
    light: frame(`${sun(25, 5, l)}${lines(13, 21, 24, ink(l), 2)}`, l.bg),
    dark: frame(`${moon('M28 7a5.5 5.5 0 1 0 2 10.5A6.5 6.5 0 1 1 28 7z', d)}${lines(13, 21, 24, ink(d), 2)}`, d.bg),
    system: frame(
      `<rect width="25" height="30" fill="${l.bg}"/><rect x="25" width="25" height="30" fill="${d.bg}"/>` +
      `${sun(14, 4.5, l)}${moon('M36 7.5a5 5 0 1 0 2 9.5A6 6 0 1 1 36 7.5z', d)}` +
      `${lines(7, 21, 12, ink(l), 2)}${lines(31, 21, 12, ink(d), 2)}`
    )
  };
}

export const READING_ART = {
  tabs: frame(
    `<rect x="4" y="3" width="42" height="24" rx="2" fill="var(--bg)" stroke="var(--line)"/>` +
    `<rect x="4" y="3" width="12" height="4" rx="1" fill="var(--surface-2)"/><rect x="17" y="3" width="12" height="4" rx="1" fill="var(--accent)"/>` +
    `${lines(8, 12, 30, 'var(--text-3)', 3)}` +
    `<path d="M36 20l6-6m0 0h-4.5m4.5 0v4.5" stroke="var(--accent)" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`
  ),
  inline: frame(
    `${lines(5, 5, 40, 'var(--line)', 6, 4)}` +
    `<rect width="50" height="30" fill="var(--text)" opacity="0.35"/>` +
    `<rect x="10" y="6" width="30" height="24" rx="2.5" fill="var(--surface)"/>` +
    `<rect x="13" y="9" width="16" height="2" rx="1" fill="var(--text)"/>${lines(13, 14, 24, 'var(--text-3)', 4, 3)}`
  )
};

export const LAYOUT_ART = {
  scroll: frame(
    `<rect x="6" y="3" width="32" height="7" rx="1.5" fill="var(--bg)" stroke="var(--line)"/>` +
    `<rect x="6" y="12" width="32" height="7" rx="1.5" fill="var(--bg)" stroke="var(--line)"/>` +
    `<rect x="6" y="21" width="32" height="7" rx="1.5" fill="var(--bg)" stroke="var(--line)"/>` +
    `<rect x="43" y="3" width="2.5" height="24" rx="1.25" fill="var(--surface-2)"/><rect x="43" y="11" width="2.5" height="8" rx="1.25" fill="var(--accent)"/>`
  ),
  paged: frame(
    `<rect x="12" y="3" width="26" height="10" rx="1.5" fill="var(--bg)" stroke="var(--line)"/>` +
    `<rect x="12" y="16" width="26" height="10" rx="1.5" fill="var(--bg)" stroke="var(--line)"/>` +
    `<path d="M7 12l-3 3 3 3" stroke="var(--text-3)" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="M43 12l3 3-3 3" stroke="var(--accent)" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`
  )
};

/** What's new: the sidebar list, plain, or with a count beside two of its rows. */
export const FRESH_ART = {
  off: frame(`${lines(6, 7, 26, 'var(--text-3)', 4, 5.5)}`),
  on: frame(
    `${lines(6, 7, 26, 'var(--text-3)', 4, 5.5)}` +
    `<rect x="36" y="5.2" width="9" height="4.6" rx="2.3" fill="var(--accent)"/><rect x="36" y="16.2" width="9" height="4.6" rx="2.3" fill="var(--accent)"/>`
  )
};
