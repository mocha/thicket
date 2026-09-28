/**
 * How wide the desktop sidebar is, chosen by dragging its edge. Kept per
 * device in this browser, like which groups are folded: a laptop and a wide
 * monitor want different answers, and nothing here reaches the server.
 *
 * The width lands on <html> as --nav-w, which the sidebar, the account menu
 * that hangs off it, and the page's left margin all measure from. A line in
 * app.html reads the same key before first paint, so the page doesn't jump.
 */
const KEY = 'thicket:nav-width';
export const NAV_W_MIN = 200;
export const NAV_W_MAX = 360;
export const NAV_W_DEFAULT = 240;

export const navWidth = $state<{ px: number }>({ px: NAV_W_DEFAULT });

const clamp = (px: number) => Math.round(Math.max(NAV_W_MIN, Math.min(NAV_W_MAX, px)));

function apply() {
  const root = document.documentElement;
  if (navWidth.px === NAV_W_DEFAULT) root.style.removeProperty('--nav-w');
  else root.style.setProperty('--nav-w', `${navWidth.px}px`);
}

export function loadNavWidth() {
  try {
    const v = Number(localStorage.getItem(KEY));
    if (Number.isFinite(v) && v > 0) navWidth.px = clamp(v);
  } catch { /* the default, then */ }
  apply();
}

/** Show a width now. Pass `keep` once the reader lets go, so a drag writes storage once, not on every move. */
export function setNavWidth(px: number, keep = true) {
  navWidth.px = clamp(px);
  apply();
  if (!keep) return;
  try {
    if (navWidth.px === NAV_W_DEFAULT) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, String(navWidth.px));
  } catch { /* stays for the session */ }
}
