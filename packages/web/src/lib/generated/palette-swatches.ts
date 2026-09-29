// Generated from app.css by scripts/palette-swatches.mjs — do not edit.
// This file is regenerated on every dev, build, and check (see the
// "palette" script in package.json). Edit the colors in app.css instead.

import type { Palette, Accent } from '$lib/display.svelte';

export type Sw = { bg: string; surface: string; text: string; accent: string };

export const SWATCHES: Record<Palette, { light: Sw; dark: Sw }> = {
  default: { light: { bg: '#f6f1e8', surface: '#fffdf9', text: '#1d1a14', accent: '#2f5d3a' }, dark: { bg: '#16140f', surface: '#1f1c15', text: '#efe9dc', accent: '#7fb08a' } },
  slate: { light: { bg: '#efefee', surface: '#fcfcfb', text: '#1e1f20', accent: '#2f5d3a' }, dark: { bg: '#161718', surface: '#1f2021', text: '#e6e6e6', accent: '#7fb08a' } },
  ember: { light: { bg: '#fbf4ec', surface: '#fffaf4', text: '#23170f', accent: '#b53802' }, dark: { bg: '#1a120c', surface: '#241a12', text: '#f4e9dc', accent: '#ff8a4c' } },
  parchment: { light: { bg: '#eadfcb', surface: '#f2e9d8', text: '#4a3b2a', accent: '#7a5535' }, dark: { bg: '#26211a', surface: '#2d2820', text: '#cfc2ad', accent: '#c59f70' } },
  plum: { light: { bg: '#e9e1e6', surface: '#f2ecf0', text: '#45313f', accent: '#7a3d68' }, dark: { bg: '#231c21', surface: '#2b2328', text: '#d4c6cf', accent: '#c894b8' } },
  contrast: { light: { bg: '#ffffff', surface: '#ffffff', text: '#000000', accent: '#0050a0' }, dark: { bg: '#000000', surface: '#000000', text: '#ffffff', accent: '#7db8ff' } },
  mono: { light: { bg: '#ffffff', surface: '#ffffff', text: '#000000', accent: '#000000' }, dark: { bg: '#000000', surface: '#000000', text: '#ffffff', accent: '#ffffff' } }
};

export const ACCENT_HEX: Record<Accent, { light: string; dark: string }> = {
  blue: { light: '#0050a0', dark: '#7db8ff' },
  orange: { light: '#a24c00', dark: '#ffb454' },
  green: { light: '#006a4e', dark: '#4fd1a5' },
  purple: { light: '#7a2d8a', dark: '#e19bea' }
};
