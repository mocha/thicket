/**
 * How thicket looks on this screen: light or dark, and what it is set in.
 *
 * Both live in localStorage rather than on the account, because they belong to
 * the device, not the person — a phone in bed at night and a desktop at noon
 * want different answers, and a reader who needs OpenDyslexic needs it on the
 * machine they read from. Nothing here reaches the server.
 *
 * Applied as `data-theme` and `data-font` on <html>; app.css defines what those
 * mean, and a few lines in app.html read the same two keys before first paint
 * so a dark reader never gets a white flash on the way in.
 */
export type Theme = 'system' | 'light' | 'dark';
export type Font = 'sans' | 'serif' | 'dyslexic';

const THEME_KEY = 'thicket:theme';
const FONT_KEY = 'thicket:font';

export const THEMES: { id: Theme; label: string; note: string }[] = [
  { id: 'system', label: 'Match my device', note: 'Follows your system setting, including its light/dark schedule.' },
  { id: 'light', label: 'Light', note: 'Paper, whatever the device is doing.' },
  { id: 'dark', label: 'Dark', note: 'Dim, whatever the device is doing.' }
];

export const FONTS: { id: Font; label: string; note: string }[] = [
  { id: 'sans', label: 'Sans-serif', note: 'Your system’s own interface face. The default.' },
  { id: 'serif', label: 'Serif', note: 'Book-like, for long reading.' },
  { id: 'dyslexic', label: 'OpenDyslexic', note: 'Weighted letterforms designed to be harder to flip or swap.' }
];

export const appearance = $state<{ theme: Theme; font: Font }>({ theme: 'system', font: 'sans' });

const isTheme = (v: unknown): v is Theme => v === 'system' || v === 'light' || v === 'dark';
const isFont = (v: unknown): v is Font => v === 'sans' || v === 'serif' || v === 'dyslexic';

/** Private browsing and locked-down browsers throw on storage; a missing preference is not an error. */
function remember(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* the choice still applies for this session */ }
}

function apply() {
  const root = document.documentElement;
  if (appearance.theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = appearance.theme;
  if (appearance.font === 'sans') delete root.dataset.font;
  else root.dataset.font = appearance.font;
  paintBrowserChrome();
}

/**
 * The address bar and task switcher take their colour from <meta theme-color>.
 * Two media-scoped tags cover "match my device"; an explicit choice needs a
 * third, unscoped one, which wins by being last.
 */
function paintBrowserChrome() {
  const id = 'theme-color-override';
  document.getElementById(id)?.remove();
  if (appearance.theme === 'system') return;
  const meta = document.createElement('meta');
  meta.id = id;
  meta.name = 'theme-color';
  meta.content = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  document.head.append(meta);
}

/** Read what the pre-paint script already applied, so the store agrees with the screen. */
export function loadAppearance() {
  try {
    const t = localStorage.getItem(THEME_KEY);
    const f = localStorage.getItem(FONT_KEY);
    if (isTheme(t)) appearance.theme = t;
    if (isFont(f)) appearance.font = f;
  } catch { /* defaults stand */ }
  apply();
}

export function setTheme(theme: Theme) {
  appearance.theme = theme;
  remember(THEME_KEY, theme);
  apply();
}

export function setFont(font: Font) {
  appearance.font = font;
  remember(FONT_KEY, font);
  apply();
}
