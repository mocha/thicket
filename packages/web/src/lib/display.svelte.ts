/**
 * How thicket looks and reads on THIS screen. One record, kept in this
 * browser's storage, never on the account.
 *
 * That is deliberate: a phone in bed and a desk at noon want different
 * answers, a reader who needs OpenDyslexic needs it on the machine they read
 * from, and an e-ink tablet wants pages and no colour while the laptop wants
 * neither. Nothing here reaches the server.
 *
 * The record is applied as data attributes and a few custom properties on
 * <html>; app.css defines what they mean. A few lines in app.html read the
 * same key before first paint so a dark reader never gets a white flash.
 *
 * Whether the key exists at all is the one bit the configurator cares about:
 * a device with no record has never been set up, and gets the walkthrough.
 */
export type Appearance = 'system' | 'light' | 'dark';
export type Palette = 'default' | 'kingfisher' | 'slate' | 'ember' | 'parchment' | 'graphite' | 'fog' | 'contrast' | 'mono';
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
  /** Only High contrast uses it; the other palettes bring their own. */
  accent: Accent;
  fonts: Record<Role, { family: Family; size: Size }>;
  reading: ReadingMode;
  layout: Layout;
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
  layout: 'scroll'
};

export const APPEARANCES: { id: Appearance; label: string; note: string }[] = [
  { id: 'system', label: 'Match my device', note: 'Follows your system setting, including its light/dark schedule.' },
  { id: 'light', label: 'Light', note: 'Paper, whatever the device is doing.' },
  { id: 'dark', label: 'Dark', note: 'Dim, whatever the device is doing.' }
];

export const PALETTES: { id: Palette; label: string; note: string }[] = [
  { id: 'default', label: 'Thicket', note: 'Cream paper and moss green. The default.' },
  { id: 'kingfisher', label: 'Kingfisher', note: 'Cool white, river-blue accent. Vivid.' },
  { id: 'slate', label: 'Slate', note: 'Blue-grey stone, steel accent. Cool and calm.' },
  { id: 'ember', label: 'Ember', note: 'Ivory, burnt-orange accent. Warm and awake.' },
  { id: 'parchment', label: 'Parchment', note: 'Sepia on old paper. Soft, for eyes that find black on white harsh.' },
  { id: 'graphite', label: 'Graphite', note: 'Plain greys, quiet steel accent.' },
  { id: 'fog', label: 'Fog', note: 'Grey on grey, sage accent. The gentlest.' },
  { id: 'contrast', label: 'High contrast', note: 'Black and white with hard edges and one strong accent.' },
  { id: 'mono', label: 'Black and white', note: 'Two colours, no shading. For e-ink.' }
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
  { id: 'inline', label: 'In the app', note: 'A post opens here, in a reader over the list. Sites that only send a preview still get a link out.' }
];

export const LAYOUTS: { id: Layout; label: string; note: string }[] = [
  { id: 'scroll', label: 'Scrolling', note: 'One long list. Scroll to move.' },
  { id: 'paged', label: 'Pages', note: 'As many posts as fit the screen, then a page turn. For e-ink, and for anyone who prefers a still page.' }
];

export const sizeScale = (s: Size) => 1 + s * 0.125;
export const sizeLabel = (s: Size) => `${Math.round(sizeScale(s) * 100)}%`;

export const display = $state<Display & { configured: boolean }>({ ...structuredClone(DEFAULTS), configured: false });

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
    palette: oneOf(PALETTES, r.palette, DEFAULTS.palette),
    accent: oneOf(ACCENTS, r.accent, DEFAULTS.accent),
    fonts: { headings: role('headings'), reading: role('reading'), app: role('app') },
    reading: oneOf(READING_MODES, r.reading, DEFAULTS.reading),
    layout: oneOf(LAYOUTS, r.layout, DEFAULTS.layout)
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
 * The address bar and task switcher take their colour from <meta theme-color>.
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

/** Change one or more fields. Applies immediately and remembers on this device. */
export function setDisplay(patch: Partial<Omit<Display, 'fonts'>> & { fonts?: Partial<Record<Role, Partial<{ family: Family; size: Size }>>> }) {
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
  if (display.configured) return;
  display.configured = true;
  remember(snapshot());
}

function snapshot(): Display {
  const { configured: _c, ...rest } = display;
  return structuredClone($state.snapshot(rest)) as Display;
}
