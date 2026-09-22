#!/usr/bin/env node
/**
 * Reads packages/web/src/app.css and emits
 * packages/web/src/lib/generated/palette-swatches.ts, so the theme picker's
 * swatch colors can never drift from the actual stylesheet.
 *
 * What we parse out of app.css:
 *
 * 1. The default palette lives in the bare `:root { ... }` block (the very
 *    first one in the file) as `--l-*` / `--d-*` custom properties (light and
 *    dark halves of every token).
 * 2. Every other color theme is a `:root[data-palette='ID'] { ... }` block
 *    that redeclares the same `--l-*` / `--d-*` subset (bg, surface, text,
 *    accent, etc.) for that theme.
 * 3. The "contrast" theme's accent picker is a separate choice layered on
 *    top of it: the block's own `--l-accent` / `--d-accent` are the "blue"
 *    accent, and three sibling blocks,
 *    `:root[data-palette='contrast'][data-accent='orange|green|purple']`,
 *    each override just `--l-accent` / `--d-accent` for that accent choice.
 *
 * Only bg / surface / text / accent (light + dark) are needed for the
 * swatches, so that's all we pull out of each block.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSS_PATH = join(__dirname, '../src/app.css');
const OUT_PATH = join(__dirname, '../src/lib/generated/palette-swatches.ts');

// Keep this list in sync with the `Palette` union in src/lib/display.svelte.ts.
const PALETTE_IDS = ['default', 'kingfisher', 'slate', 'ember', 'parchment', 'graphite', 'fog', 'contrast', 'mono'];
// Keep this list in sync with the `Accent` union in src/lib/display.svelte.ts.
const ACCENT_IDS = ['blue', 'orange', 'green', 'purple'];

const HEX_RE = /^#[0-9a-fA-F]{3,8}$/;

function fail(message) {
  console.error(`palette-swatches: ${message}`);
  process.exit(1);
}

function extractBlock(css, selectorPattern, label) {
  // Every block we care about here is a flat list of CSS custom-property
  // declarations with no nested rules, so its body never contains a `}` —
  // matching up to the first `}` after the selector is exact, not a guess.
  const re = new RegExp(`${selectorPattern}\\s*\\{([^}]*)\\}`);
  const match = css.match(re);
  if (!match) fail(`could not find ${label} in app.css (expected a block matching /${selectorPattern}/).`);
  return match[1];
}

function extractVar(block, name, label) {
  const re = new RegExp(`--${name}:\\s*([^;]+);`);
  const match = block.match(re);
  if (!match) fail(`missing "--${name}" in ${label}.`);
  const value = match[1].trim();
  if (!HEX_RE.test(value)) fail(`"--${name}" in ${label} is "${value}", which is not a hex color.`);
  return value;
}

function extractSwatch(block, label) {
  return {
    light: {
      bg: extractVar(block, 'l-bg', label),
      surface: extractVar(block, 'l-surface', label),
      text: extractVar(block, 'l-text', label),
      accent: extractVar(block, 'l-accent', label)
    },
    dark: {
      bg: extractVar(block, 'd-bg', label),
      surface: extractVar(block, 'd-surface', label),
      text: extractVar(block, 'd-text', label),
      accent: extractVar(block, 'd-accent', label)
    }
  };
}

const css = readFileSync(CSS_PATH, 'utf8');

const swatches = {};
for (const id of PALETTE_IDS) {
  const selector = id === 'default' ? ':root' : `:root\\[data-palette='${id}'\\]`;
  const label = id === 'default' ? "the default ':root' block" : `the ':root[data-palette=${JSON.stringify(id)}]' block`;
  const block = extractBlock(css, selector, label);
  swatches[id] = extractSwatch(block, label);
}

// The "blue" accent is the contrast palette's own accent, not an override.
const contrastBlock = extractBlock(css, `:root\\[data-palette='contrast'\\]`, "the contrast palette's block");
const accentHex = {
  blue: { light: extractVar(contrastBlock, 'l-accent', 'the contrast palette block'), dark: extractVar(contrastBlock, 'd-accent', 'the contrast palette block') }
};
for (const id of ACCENT_IDS) {
  if (id === 'blue') continue;
  const label = `the ':root[data-palette=\\'contrast\\'][data-accent=${JSON.stringify(id)}]' block`;
  const block = extractBlock(css, `:root\\[data-palette='contrast'\\]\\[data-accent='${id}'\\]`, label);
  accentHex[id] = {
    light: extractVar(block, 'l-accent', label),
    dark: extractVar(block, 'd-accent', label)
  };
}

function formatSw(sw) {
  return `{ bg: '${sw.bg}', surface: '${sw.surface}', text: '${sw.text}', accent: '${sw.accent}' }`;
}

const swatchesBody = PALETTE_IDS.map((id) => `  ${id}: { light: ${formatSw(swatches[id].light)}, dark: ${formatSw(swatches[id].dark)} }`).join(',\n');
const accentBody = ACCENT_IDS.map((id) => `  ${id}: { light: '${accentHex[id].light}', dark: '${accentHex[id].dark}' }`).join(',\n');

const output = `// Generated from app.css by scripts/palette-swatches.mjs — do not edit.
// This file is regenerated on every dev, build, and check (see the
// "palette" script in package.json). Edit the colors in app.css instead.

import type { Palette, Accent } from '$lib/display.svelte';

export type Sw = { bg: string; surface: string; text: string; accent: string };

export const SWATCHES: Record<Palette, { light: Sw; dark: Sw }> = {
${swatchesBody}
};

export const ACCENT_HEX: Record<Accent, { light: string; dark: string }> = {
${accentBody}
};
`;

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, output);
console.log(`palette-swatches: wrote ${OUT_PATH}`);
