/**
 * How thicket looks and reads on THIS screen. One record, kept in this
 * browser's storage; changing it never changes another device.
 *
 * That is deliberate: a phone in bed and a desk at noon want different
 * answers, a reader who needs OpenDyslexic needs it on the machine they read
 * from, and an e-ink tablet wants pages and no color while the laptop wants
 * neither. The account can keep one saved copy to offer a device that hasn't
 * been set up (issue #186, lib/saved-display.svelte.ts), but only when someone
 * saves it on purpose: nothing here sends it.
 *
 * The record is applied as data attributes and a few custom properties on
 * <html>; app.css defines what they mean. A few lines in app.html read the
 * same key before first paint so a dark reader never gets a white flash.
 *
 * Whether the key exists at all is the one bit the configurator cares about:
 * a device with no record has never been set up, and gets the walkthrough.
 */
export type Appearance = 'system' | 'light' | 'dark';
export type Palette = 'default' | 'slate' | 'ember' | 'parchment' | 'plum' | 'contrast' | 'mono';
export type Accent = 'blue' | 'orange' | 'green' | 'purple';
export type Family = 'sans' | 'serif' | 'dyslexic';
export type Role = 'headings' | 'reading' | 'app';
/** A size step. Each is 12.5%; the range runs from 50% (-4) to 250% (+12). */
export type Size = number;
export const SIZE_MIN = -4;
export const SIZE_MAX = 12;
export type ReadingMode = 'tabs' | 'inline';
export type Layout = 'scroll' | 'paged';

export type Display = {
  appearance: Appearance;
  palette: Palette;
  /** Only Crisp uses it; the other palettes bring their own. */
  accent: Accent;
  fonts: Record<Role, { family: Family; size: Size }>;
  reading: ReadingMode;
  layout: Layout;
  /**
   * "What's new": count posts since I last opened each collection, and mark
   * the new ones. Off by default. The mark itself is kept on the account (one
   * timestamp per collection, nothing per post), but only written from a
   * device where this is on, so turning it off here means this device records
   * nothing.
   */
  fresh: boolean;
};

export const KEY = 'thicket:display';
const LEGACY_THEME = 'thicket:theme';
const LEGACY_FONT = 'thicket:font';

export const DEFAULTS: Display = {
  appearance: 'system',
  palette: 'default',
  accent: 'blue',
  fonts: { headings: { family: 'serif', size: 0 }, reading: { family: 'sans', size: 0 }, app: { family: 'sans', size: 0 } },
  reading: 'tabs',
  layout: 'scroll',
  fresh: false
};

export const APPEARANCES: { id: Appearance; label: string; note: string }[] = [
  { id: 'system', label: 'Match my device', note: 'Follows your system setting, including its light/dark schedule.' },
  { id: 'light', label: 'Light', note: 'Paper, whatever the device is doing.' },
  { id: 'dark', label: 'Dark', note: 'Dim, whatever the device is doing.' }
];

export const PALETTES: { id: Palette; label: string; note: string }[] = [
  { id: 'default', label: 'Thicket', note: 'The default. Cream and green.' },
  { id: 'slate', label: 'Neutral', note: 'No cream tint. Gray and green.' },
  { id: 'ember', label: 'Vivid', note: 'Bolder color. Ivory and orange.' },
  { id: 'parchment', label: 'Soft sepia', note: 'Low contrast. Warm sepia.' },
  { id: 'plum', label: 'Soft plum', note: 'Low contrast. Cool mauve.' },
  { id: 'contrast', label: 'Crisp', note: 'High contrast. Black and white, one accent.' },
  { id: 'mono', label: 'Black and white', note: 'For e‑ink. No color or shading.' }
];

export const ACCENTS: { id: Accent; label: string }[] = [
  { id: 'blue', label: 'Blue' },
  { id: 'orange', label: 'Orange' },
  { id: 'green', label: 'Green' },
  { id: 'purple', label: 'Purple' }
];

export const FAMILIES: { id: Family; label: string; note: string }[] = [
  { id: 'serif', label: 'Serif', note: 'Book-like.' },
  { id: 'sans', label: 'Sans-serif', note: 'Your device’s own face.' },
  { id: 'dyslexic', label: 'OpenDyslexic', note: 'Weighted letterforms, harder to flip or swap.' }
];

export const ROLES: { id: Role; label: string; note: string }[] = [
  { id: 'headings', label: 'Headlines', note: 'Post titles and page headings.' },
  { id: 'reading', label: 'Text', note: 'Post summaries and articles you read here.' },
  { id: 'app', label: 'App', note: 'Buttons, menus, everything else.' }
];

export const READING_MODES: { id: ReadingMode; label: string; note: string }[] = [
  { id: 'tabs', label: 'New tabs', note: 'A post opens on its own site, in a new tab.' },
  { id: 'inline', label: 'In the app', note: 'A post opens in the in-app reader. Sites that only send a preview still link out.' }
];

export const LAYOUTS: { id: Layout; label: string; note: string }[] = [
  { id: 'scroll', label: 'Scrolling', note: 'One long list. Scroll to move.' },
  { id: 'paged', label: 'Pages', note: 'As many posts as fit the screen, then a page turn. For e-ink, and for anyone who prefers a still page.' }
];

export const sizeScale = (s: Size) => 1 + s * 0.125;
export const sizeLabel = (s: Size) => `${Math.round(sizeScale(s) * 100)}%`;

export const display = $state<Display & { configured: boolean }>({ ...structuredClone(DEFAULTS), configured: false });

/** Themes that have been retired, and the one each reader of them moves to. Keep in step with app.html. */
const RETIRED_PALETTES: Record<string, Palette> = { kingfisher: 'slate', graphite: 'slate', fog: 'slate' };

const oneOf = <T extends string>(list: readonly { id: T }[], v: unknown, fallback: T): T =>
  list.some((x) => x.id === v) ? (v as T) : fallback;
const isSize = (v: unknown): v is Size => Number.isInteger(v) && (v as number) >= SIZE_MIN && (v as number) <= SIZE_MAX;

/** Accept whatever is in storage, field by field, so a stale or partial record still yields a full one. */
function coerce(raw: unknown): Display {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const fonts = (r.fonts && typeof r.fonts === 'object' ? r.fonts : {}) as Record<string, unknown>;
  const role = (id: Role) => {
    const f = (fonts[id] && typeof fonts[id] === 'object' ? fonts[id] : {}) as Record<string, unknown>;
    return { family: oneOf(FAMILIES, f.family, DEFAULTS.fonts[id].family), size: isSize(f.size) ? f.size : 0 };
  };
  return {
    appearance: oneOf(APPEARANCES, r.appearance, DEFAULTS.appearance),
    palette: oneOf(PALETTES, RETIRED_PALETTES[r.palette as string] ?? r.palette, DEFAULTS.palette),
    accent: oneOf(ACCENTS, r.accent, DEFAULTS.accent),
    fonts: { headings: role('headings'), reading: role('reading'), app: role('app') },
    reading: oneOf(READING_MODES, r.reading, DEFAULTS.reading),
    layout: oneOf(LAYOUTS, r.layout, DEFAULTS.layout),
    fresh: r.fresh === true
  };
}

/**
 * Before this record existed, light/dark and a single reading font lived under
 * two keys. Carry them across once so nobody's screen changes on upgrade:
 * the old "serif" set the body while headings were already serif; the old
 * "dyslexic" set everything.
 */
function fromLegacy(): Display | null {
  const t = localStorage.getItem(LEGACY_THEME);
  const f = localStorage.getItem(LEGACY_FONT);
  if (t === null && f === null) return null;
  const d = structuredClone(DEFAULTS);
  d.appearance = oneOf(APPEARANCES, t, 'system');
  if (f === 'serif') d.fonts.reading.family = 'serif';
  if (f === 'dyslexic') for (const role of ROLES) d.fonts[role.id].family = 'dyslexic';
  return d;
}

/** Private browsing and locked-down browsers throw on storage; a missing preference is not an error. */
function remember(value: Display) {
  try {
    localStorage.setItem(KEY, JSON.stringify(value));
    localStorage.removeItem(LEGACY_THEME);
    localStorage.removeItem(LEGACY_FONT);
  } catch { /* the choice still applies for this session */ }
}

function apply() {
  const root = document.documentElement;
  const set = (name: string, value: string | null) => { if (value === null) delete root.dataset[name]; else root.dataset[name] = value; };
  set('theme', display.appearance === 'system' ? null : display.appearance);
  set('palette', display.palette === 'default' ? null : display.palette);
  set('accent', display.palette === 'contrast' ? display.accent : null);
  set('layout', display.layout === 'scroll' ? null : display.layout);
  set('reading', display.reading === 'tabs' ? null : display.reading);
  for (const role of ROLES) {
    const f = display.fonts[role.id];
    set(`font${role.id[0].toUpperCase()}${role.id.slice(1)}`, f.family === DEFAULTS.fonts[role.id].family ? null : f.family);
    root.style.setProperty(`--size-${role.id}`, String(sizeScale(f.size)));
  }
  paintBrowserChrome();
}

/**
 * The address bar and task switcher take their color from <meta theme-color>.
 * Two media-scoped tags cover "match my device" on the default palette; any
 * explicit choice needs a third, unscoped one, which wins by being last.
 */
function paintBrowserChrome() {
  const id = 'theme-color-override';
  document.getElementById(id)?.remove();
  if (display.appearance === 'system' && display.palette === 'default') return;
  const meta = document.createElement('meta');
  meta.id = id;
  meta.name = 'theme-color';
  meta.content = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  document.head.append(meta);
}

/** Read what the pre-paint script already applied, so the store agrees with the screen. */
export function loadDisplay() {
  let found: Display | null = null;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw !== null) {
      found = coerce(JSON.parse(raw));
      display.configured = true;
    } else {
      // Older installs kept two keys. Carry the values over, but let this screen see the walkthrough once;
      // that is what writes the record and retires the old keys.
      found = fromLegacy();
    }
  } catch { /* defaults stand */ }
  if (found) Object.assign(display, found);
  apply();
}

/**
 * Take up the record as it stands in storage now. Another tab of thicket may
 * have changed it since this one loaded: without this, that tab's choice never
 * shows here, and the next change made here writes this tab's old values back
 * over it (a theme picked in one tab quietly undone from another).
 */
function sync() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return;
    const found = coerce(JSON.parse(raw));
    if (display.configured && JSON.stringify(found) === JSON.stringify(snapshot())) return;
    Object.assign(display, found);
    display.configured = true;
    apply();
  } catch { /* what is on screen stands */ }
}

/**
 * Keep this tab in step with the others. The browser reports a change made in
 * another tab as it happens; a tab that was asleep in the background (or
 * brought back by the Back button) may have missed that, so it also looks
 * again whenever it comes back into view.
 */
export function watchDisplay() {
  const onStorage = (e: StorageEvent) => { if (e.key === KEY || e.key === null) sync(); };
  const onVisible = () => { if (document.visibilityState === 'visible') sync(); };
  window.addEventListener('storage', onStorage);
  window.addEventListener('pageshow', sync);
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener('pageshow', sync);
    document.removeEventListener('visibilitychange', onVisible);
  };
}

/** Change one or more fields. Applies immediately and remembers on this device. */
export function setDisplay(patch: Partial<Omit<Display, 'fonts'>> & { fonts?: Partial<Record<Role, Partial<{ family: Family; size: Size }>>> }) {
  // Start from the latest record, so only the fields being changed here are changed.
  sync();
  const { fonts, ...rest } = patch;
  Object.assign(display, rest);
  if (fonts) for (const role of ROLES) if (fonts[role.id]) Object.assign(display.fonts[role.id], fonts[role.id]);
  display.configured = true;
  remember(snapshot());
  apply();
}

export function setFont(role: Role, patch: Partial<{ family: Family; size: Size }>) {
  setDisplay({ fonts: { [role]: patch } });
}

export function stepSize(role: Role, delta: 1 | -1) {
  const next = Math.max(SIZE_MIN, Math.min(SIZE_MAX, display.fonts[role].size + delta));
  if (next !== display.fonts[role].size) setFont(role, { size: next });
}

/**
 * Write the current values down as this device's record, even if nothing was
 * changed. The configurator calls this when it opens: from then on the device
 * counts as set up, and dismissing the walkthrough is a choice like any other.
 */
export function markConfigured() {
  sync();
  if (display.configured) return;
  display.configured = true;
  remember(snapshot());
}

/** This device's settings as they stand now, including any another tab just changed. */
export function currentDisplay(): Display {
  sync();
  return snapshot();
}

/**
 * Take on a whole set of saved settings, as if picked here: applies now, is
 * remembered on this device, and counts as set up. Read the same tolerant way
 * as this device's own record, so a theme retired since it was saved moves to
 * its replacement.
 */
export function useDisplay(saved: unknown) {
  Object.assign(display, coerce(saved));
  display.configured = true;
  remember(snapshot());
  apply();
}

/** One line per setting setup asks about, saying what it's set to, for the setup list and the saved-settings offer. */
export function describeDisplay(d: Display): { key: 'appearance' | 'theme' | 'fonts' | 'reading'; label: string; value: string }[] {
  const label = <T extends string>(list: { id: T; label: string }[], id: T) => list.find((x) => x.id === id)?.label ?? id;
  const face = (f: Family) => (f === 'dyslexic' ? 'OpenDyslexic' : f === 'serif' ? 'serif' : 'sans');
  const { headings, reading, app } = d.fonts;
  let fonts = `${face(headings.family)} headlines, ${face(reading.family)} text`;
  if (app.family !== reading.family) fonts += `, ${face(app.family)} app`;
  const sizes = new Set([headings.size, reading.size, app.size]);
  if (sizes.size > 1) fonts += ', custom sizes';
  else if (headings.size !== 0) fonts += `, ${sizeLabel(headings.size)}`;
  return [
    { key: 'appearance', label: 'Light or dark', value: label(APPEARANCES, d.appearance) },
    { key: 'theme', label: 'Color theme', value: label(PALETTES, d.palette) + (d.palette === 'contrast' ? `, ${label(ACCENTS, d.accent).toLowerCase()}` : '') },
    { key: 'fonts', label: 'Fonts', value: fonts[0].toUpperCase() + fonts.slice(1) },
    { key: 'reading', label: 'Opening a post', value: label(READING_MODES, d.reading) }
  ];
}

function snapshot(): Display {
  const { configured: _c, ...rest } = display;
  return structuredClone($state.snapshot(rest)) as Display;
}

export const FRESH_OPTIONS: { id: 'on' | 'off'; label: string; note: string }[] = [
  { id: 'off', label: 'Off', note: 'Do not show a count of new posts next to each collection.' },
  { id: 'on', label: 'On', note: 'Show a count of unread posts next to each collection.' }
];
