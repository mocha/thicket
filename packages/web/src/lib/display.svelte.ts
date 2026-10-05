/**
 * How thicket looks and reads. One record, kept on the account and the same
 * on every device (issue #186): someone who sets up thicket once expects their
 * theme and fonts to follow them to the next screen they sign in on, and not
 * to be walked through setup again. There are no per-device overrides.
 *
 * This browser's storage keeps a copy. It is what paints the first frame (a
 * few lines in app.html read it before anything draws, so a dark reader never
 * gets a white flash), what keeps tabs on one device in step, and the whole
 * record for a visitor who isn't signed in. The account's record replaces the
 * copy when someone signs in or the page loads (useAccount), and again when a
 * tab comes back into view after a while, in case another device changed it.
 * Every change made here goes to both.
 *
 * The record is applied as data attributes and a few custom properties on
 * <html>; app.css defines what they mean.
 *
 * Whether a record exists at all is the one bit the configurator cares about:
 * an account (or, signed out, a browser) with no record has never been set
 * up, and gets the walkthrough. Before records were kept on the account, each
 * device kept its own; the first device to sign in after that change brings
 * its record up to an account that has none, and never over one that does.
 */
import { authApi } from './api';

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
   * "What's new": count posts since I last read in each collection, and mark
   * the new ones. Off by default. The switch follows the account like the
   * rest of this record; the point each count starts from is still kept per
   * device (marks.svelte.ts).
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
  const onShow = () => { sync(); refresh(); };
  // Leaving the tab sends a change still waiting to go, rather than risk losing it with the tab.
  const onVisible = () => { if (document.visibilityState === 'visible') onShow(); else flush(); };
  window.addEventListener('storage', onStorage);
  window.addEventListener('pageshow', onShow);
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener('pageshow', onShow);
    document.removeEventListener('visibilitychange', onVisible);
  };
}

// ---- the account's copy -----------------------------------------------------

/** Whose record this is, when someone is signed in. */
let account: number | null = null;
/** A change waiting to go to the account, gathered so stepping a size five times sends once. */
let pending: ReturnType<typeof setTimeout> | null = null;
/** Saves sent and not yet answered. While any are out, what the account says may be older than the screen. */
let saving = 0;
let fetchedAt = 0;
const SAVE_AFTER_MS = 500;
const REFRESH_AFTER_MS = 60_000;

/** Take up a record from the account: show it, and keep it as this browser's copy. */
function take(raw: unknown) {
  const found = coerce(raw);
  const same = display.configured && JSON.stringify(found) === JSON.stringify(snapshot());
  display.configured = true;
  if (same) return;
  Object.assign(display, found);
  remember(found);
  apply();
}

/**
 * The signed-in person changed, or was learned on load (session.svelte.ts).
 * Their account's record wins. An account with none yet takes this browser's,
 * if it has one: that is how settings made on a device before records were
 * kept on the account reach it, and only an empty account takes them. With
 * neither, the configurator asks, and its answer is what the account keeps.
 */
export function useAccount(me: { id: number; display: Record<string, unknown> | null } | null) {
  if (pending) { clearTimeout(pending); pending = null; }
  account = me?.id ?? null;
  fetchedAt = Date.now();
  if (!me) return;
  if (me.display) take(me.display);
  else if (display.configured) bringUp(me.id);
}

/** Offer this browser's record to an account that has none, and take whatever the account ends up holding. */
function bringUp(id: number) {
  saving++;
  authApi.setDisplay(snapshot(), true)
    // Unless a change made here since has gone or is about to go: that is newer than either.
    .then((r) => { if (account === id && !pending && saving === 1 && r.display) take(r.display); })
    .catch(() => { /* it is offered again on the next load */ })
    .finally(() => { saving--; });
}

function save() {
  if (account === null) return;
  if (pending) clearTimeout(pending);
  pending = setTimeout(flush, SAVE_AFTER_MS);
}

function flush() {
  if (!pending) return;
  clearTimeout(pending);
  pending = null;
  if (account === null) return;
  saving++;
  // Not a failure worth a message: it applies here regardless, and the next change sends the whole record again.
  authApi.setDisplay(snapshot()).catch(() => {}).finally(() => { saving--; });
}

/** Coming back to a tab after a while: another device may have changed the record since. */
function refresh() {
  if (account === null || pending || saving || Date.now() - fetchedAt < REFRESH_AFTER_MS) return;
  const id = account;
  fetchedAt = Date.now();
  authApi.display()
    .then((r) => { if (account === id && !pending && !saving && r.display) take(r.display); })
    .catch(() => { /* what is on screen stands */ });
}

/** Change one or more fields. Applies immediately, here and on the account. */
export function setDisplay(patch: Partial<Omit<Display, 'fonts'>> & { fonts?: Partial<Record<Role, Partial<{ family: Family; size: Size }>>> }) {
  // Start from the latest record, so only the fields being changed here are changed.
  sync();
  const { fonts, ...rest } = patch;
  Object.assign(display, rest);
  if (fonts) for (const role of ROLES) if (fonts[role.id]) Object.assign(display.fonts[role.id], fonts[role.id]);
  display.configured = true;
  remember(snapshot());
  apply();
  save();
}

export function setFont(role: Role, patch: Partial<{ family: Family; size: Size }>) {
  setDisplay({ fonts: { [role]: patch } });
}

export function stepSize(role: Role, delta: 1 | -1) {
  const next = Math.max(SIZE_MIN, Math.min(SIZE_MAX, display.fonts[role].size + delta));
  if (next !== display.fonts[role].size) setFont(role, { size: next });
}

/**
 * Write the current values down as the record, even if nothing was changed.
 * The configurator calls this when it opens: from then on the account (and
 * this browser) counts as set up, and dismissing the walkthrough is a choice
 * like any other. Only an account still without a record takes it, so a
 * second device opening setup at the same moment can't undo the first one's
 * choices.
 */
export function markConfigured() {
  sync();
  if (display.configured) return;
  display.configured = true;
  remember(snapshot());
  if (account !== null) bringUp(account);
}

function snapshot(): Display {
  const { configured: _c, ...rest } = display;
  return structuredClone($state.snapshot(rest)) as Display;
}

export const FRESH_OPTIONS: { id: 'on' | 'off'; label: string; note: string }[] = [
  { id: 'off', label: 'Off', note: 'Do not show a count of new posts next to each collection.' },
  { id: 'on', label: 'On', note: 'Show a count of unread posts next to each collection.' }
];
