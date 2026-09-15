/**
 * The little pictures on the display choices. Each is a 50×30 window drawn in
 * the live tokens, so they repaint with the palette. Inline SVG strings, ours.
 */
const frame = (inner: string, bg = 'var(--surface)') =>
  `<svg viewBox="0 0 50 30" xmlns="http://www.w3.org/2000/svg"><rect width="50" height="30" fill="${bg}"/>${inner}</svg>`;

const lines = (x: number, y: number, w: number, color: string, n = 3, gap = 3) =>
  Array.from({ length: n }, (_, i) => `<rect x="${x}" y="${y + i * gap}" width="${i === n - 1 ? w * 0.6 : w}" height="1.4" rx="0.7" fill="${color}"/>`).join('');

export const APPEARANCE_ART = {
  light: frame(`<circle cx="25" cy="12" r="5" fill="var(--accent)"/>${lines(13, 21, 24, 'var(--text-3)', 2)}`, '#f6f1e8'),
  dark: frame(`<path d="M28 7a5.5 5.5 0 1 0 2 10.5A6.5 6.5 0 1 1 28 7z" fill="var(--accent)"/>${lines(13, 21, 24, '#7f7864', 2)}`, '#16140f'),
  system: frame(
    `<rect width="25" height="30" fill="#f6f1e8"/><rect x="25" width="25" height="30" fill="#16140f"/>` +
    `<circle cx="14" cy="12" r="4.5" fill="var(--accent)"/><path d="M36 7.5a5 5 0 1 0 2 9.5A6 6 0 1 1 36 7.5z" fill="var(--accent)"/>` +
    `${lines(7, 21, 12, '#8c8574', 2)}${lines(31, 21, 12, '#7f7864', 2)}`
  )
};

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
