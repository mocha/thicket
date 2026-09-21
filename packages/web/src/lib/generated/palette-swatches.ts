// Generated from app.css by scripts/palette-swatches.mjs — do not edit.
// This file is regenerated on every install, dev, build, and check (see the
// "palette" script in package.json). Edit the colors in app.css instead.

import type { Palette, Accent } from '$lib/display.svelte';

export type Sw = { bg: string; surface: string; text: string; accent: string };

export const SWATCHES: Record<Palette, { light: Sw; dark: Sw }> = {
  default: { light: { bg: '#f6f1e8', surface: '#fffdf9', text: '#1d1a14', accent: '#2f5d3a' }, dark: { bg: '#16140f', surface: '#1f1c15', text: '#efe9dc', accent: '#7fb08a' } },
  kingfisher: { light: { bg: '#eef3f7', surface: '#ffffff', text: '#10202e', accent: '#0b5fa5' }, dark: { bg: '#0d161f', surface: '#142030', text: '#e6eef6', accent: '#5fb3ff' } },
  slate: { light: { bg: '#eceff2', surface: '#f8f9fb', text: '#1f262d', accent: '#3f5f7a' }, dark: { bg: '#15191e', surface: '#1c2229', text: '#dfe5eb', accent: '#8fb0c9' } },
  ember: { light: { bg: '#fbf4ec', surface: '#fffaf4', text: '#23170f', accent: '#b93c0a' }, dark: { bg: '#1a120c', surface: '#241a12', text: '#f4e9dc', accent: '#ff8a4c' } },
  parchment: { light: { bg: '#eadfcb', surface: '#f2e9d8', text: '#4a3b2a', accent: '#7a5535' }, dark: { bg: '#26211a', surface: '#2d2820', text: '#cfc2ad', accent: '#c09a6b' } },
  graphite: { light: { bg: '#f0f0ef', surface: '#fafaf9', text: '#1c1c1c', accent: '#465a7c' }, dark: { bg: '#161616', surface: '#1e1e1e', text: '#e8e8e6', accent: '#9db0d0' } },
  fog: { light: { bg: '#e6e7e6', surface: '#ededec', text: '#3f4241', accent: '#556a67' }, dark: { bg: '#202322', surface: '#272a29', text: '#c4c8c6', accent: '#8fa6a2' } },
  contrast: { light: { bg: '#ffffff', surface: '#ffffff', text: '#000000', accent: '#0050a0' }, dark: { bg: '#000000', surface: '#000000', text: '#ffffff', accent: '#7db8ff' } },
  mono: { light: { bg: '#ffffff', surface: '#ffffff', text: '#000000', accent: '#000000' }, dark: { bg: '#000000', surface: '#000000', text: '#ffffff', accent: '#ffffff' } }
};

export const ACCENT_HEX: Record<Accent, { light: string; dark: string }> = {
  blue: { light: '#0050a0', dark: '#7db8ff' },
  orange: { light: '#a24c00', dark: '#ffb454' },
  green: { light: '#006a4e', dark: '#4fd1a5' },
  purple: { light: '#7a2d8a', dark: '#e19bea' }
};
