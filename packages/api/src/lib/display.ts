/**
 * Saved display settings (issue #186): one copy of how thicket looks, kept on
 * the account so a device that hasn't been set up can offer to use it. The
 * web app owns these settings (packages/web/src/lib/display.svelte.ts); this
 * is the same shape, checked strictly. The browser quietly swaps a bad value
 * for a default when it reads its own old data, which is right there; a save
 * is different, so anything unexpected is refused with the reason, and the
 * web app shows that reason instead of saving something other than what's on
 * screen. Keep the lists in step with the web app's.
 */
const APPEARANCES = ["system", "light", "dark"] as const;
const PALETTES = ["default", "slate", "ember", "parchment", "plum", "contrast", "mono"] as const;
const ACCENTS = ["blue", "orange", "green", "purple"] as const;
const FAMILIES = ["sans", "serif", "dyslexic"] as const;
const ROLES = ["headings", "reading", "app"] as const;
const READING = ["tabs", "inline"] as const;
const LAYOUTS = ["scroll", "paged"] as const;
const SIZE_MIN = -4;
const SIZE_MAX = 12;

type Font = { family: (typeof FAMILIES)[number]; size: number };
export type SavedDisplay = {
  appearance: (typeof APPEARANCES)[number];
  palette: (typeof PALETTES)[number];
  accent: (typeof ACCENTS)[number];
  fonts: Record<(typeof ROLES)[number], Font>;
  reading: (typeof READING)[number];
  layout: (typeof LAYOUTS)[number];
  fresh: boolean;
};

const KEYS = ["appearance", "palette", "accent", "fonts", "reading", "layout", "fresh"];

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const oneOf = (list: readonly string[], v: unknown) => typeof v === "string" && list.includes(v);

/** A device's id as the web app makes it (a random UUID), or null for anything else. */
export function parseDeviceId(raw: unknown): string | null {
  return typeof raw === "string" && /^[0-9a-f-]{8,64}$/i.test(raw) ? raw.toLowerCase() : null;
}

/**
 * How a save may change which device keeps the saved settings up to date.
 * "choose" (the default): this device becomes it, as checking the box does.
 * "sync": a background save, only taken while this device still is it, so a
 * device that missed being unchecked elsewhere can't take it back. "first":
 * an older account's first device, only taken while no device has ever been
 * chosen, so two devices opening at once can't both claim it.
 */
export type SaveMode = "choose" | "sync" | "first";
export const parseSaveMode = (raw: unknown): SaveMode => (raw === "sync" || raw === "first" ? raw : "choose");

/** The settings exactly as sent, or the first thing wrong with them. Unknown fields are refused too, so nothing extra gets stored. */
export function parseSavedDisplay(raw: unknown): { ok: true; value: SavedDisplay } | { ok: false; error: string } {
  const bad = (error: string) => ({ ok: false as const, error });
  if (!isObject(raw)) return bad("settings must be an object");
  const extra = Object.keys(raw).find((k) => !KEYS.includes(k));
  if (extra) return bad(`unknown setting ${JSON.stringify(extra).slice(0, 40)}`);
  if (!oneOf(APPEARANCES, raw.appearance)) return bad("appearance is not one of " + APPEARANCES.join(", "));
  if (!oneOf(PALETTES, raw.palette)) return bad("palette is not one of " + PALETTES.join(", "));
  if (!oneOf(ACCENTS, raw.accent)) return bad("accent is not one of " + ACCENTS.join(", "));
  if (!oneOf(READING, raw.reading)) return bad("reading is not one of " + READING.join(", "));
  if (!oneOf(LAYOUTS, raw.layout)) return bad("layout is not one of " + LAYOUTS.join(", "));
  if (typeof raw.fresh !== "boolean") return bad("fresh must be true or false");
  if (!isObject(raw.fonts)) return bad("fonts must be an object");
  const fontsExtra = Object.keys(raw.fonts).find((k) => !oneOf(ROLES, k));
  if (fontsExtra) return bad(`unknown font role ${JSON.stringify(fontsExtra).slice(0, 40)}`);
  const fonts = {} as SavedDisplay["fonts"];
  for (const role of ROLES) {
    const f = raw.fonts[role];
    if (!isObject(f)) return bad(`fonts.${role} is missing`);
    if (Object.keys(f).some((k) => k !== "family" && k !== "size")) return bad(`fonts.${role} has unknown fields`);
    if (!oneOf(FAMILIES, f.family)) return bad(`fonts.${role}.family is not one of ` + FAMILIES.join(", "));
    if (!Number.isInteger(f.size) || (f.size as number) < SIZE_MIN || (f.size as number) > SIZE_MAX) return bad(`fonts.${role}.size must be a whole number from ${SIZE_MIN} to ${SIZE_MAX}`);
    fonts[role] = { family: f.family as Font["family"], size: f.size as number };
  }
  return {
    ok: true,
    value: {
      appearance: raw.appearance as SavedDisplay["appearance"], palette: raw.palette as SavedDisplay["palette"],
      accent: raw.accent as SavedDisplay["accent"], fonts, reading: raw.reading as SavedDisplay["reading"],
      layout: raw.layout as SavedDisplay["layout"], fresh: raw.fresh,
    },
  };
}
