/**
 * Keyboard manners for a pop-up menu: the account menu, the profile picture
 * menu, a collection's "more actions". Put it on the panel that holds the
 * menu's items (`use:menu={{ anchor }}`) and it does what a menu is announced
 * as doing:
 *
 * - Opening puts focus on the first item, so a keyboard or screen reader user
 *   lands inside the menu instead of being left on the button behind it.
 * - Up and Down move between items and wrap around the ends; Home and End
 *   jump to the first and last.
 * - Tab closes the menu, the way it does everywhere else.
 * - However the menu closes, focus goes back to the button that opened it
 *   rather than falling to the top of the page. Picking an item hands focus
 *   back first, so a dialog that item opens returns there when it closes too.
 *
 * `modal` is for a menu drawn as a sheet over the whole screen (the account
 * menu on a phone): while it is open, everything else on the page is switched
 * off, so nothing behind the dimmed backdrop can be reached.
 *
 * The menu moves focus itself, and a browser left to guess (Firefox) draws no
 * focus ring for that. So it says outright: show the ring when the reader is
 * using the keyboard, leave it off when they clicked or tapped.
 *
 * Closing on Escape and on a click outside stays with the menu's owner, which
 * already knows how; this only needs telling how to close (`onclose`).
 */
import { modality } from './focus.svelte';

interface MenuOptions {
  /** What opened the menu: the button itself, or the element wrapped around it. */
  anchor: HTMLElement | null;
  onclose: () => void;
  modal?: boolean;
}

const ITEMS = '[role="menuitem"]:not([disabled])';

export function menu(panel: HTMLElement, options: MenuOptions) {
  let opts = options;
  let silenced: HTMLElement[] = [];

  /* Keyboard or pointer, kept up to date here while the menu is open: as the
     menu is torn down the shared flag still reads as it did before the key
     that closed it, which would hide the ring after Escape. */
  let keyboard = modality.keyboard;
  const onkey = () => (keyboard = true);
  const onpointer = () => (keyboard = false);
  window.addEventListener('keydown', onkey, true);
  window.addEventListener('pointerdown', onpointer, true);

  /* `focusVisible` is newer than the type definitions know about. */
  const focus = (el: HTMLElement | null | undefined) => el?.focus({ focusVisible: keyboard } as FocusOptions);
  const items = () => Array.from(panel.querySelectorAll<HTMLElement>(ITEMS));
  const trigger = () => {
    const a = opts.anchor;
    if (!a) return null;
    return a.matches('button, a') ? a : a.querySelector<HTMLElement>('button, a');
  };

  /* Switch off everything that isn't the menu or one of its ancestors. */
  function silence() {
    release();
    if (!opts.modal) return;
    for (let el: HTMLElement | null = panel; el && el !== document.body; el = el.parentElement) {
      for (const sib of Array.from(el.parentElement?.children ?? [])) {
        if (sib === el || !(sib instanceof HTMLElement) || sib.inert) continue;
        sib.inert = true;
        silenced.push(sib);
      }
    }
  }
  function release() {
    for (const el of silenced) el.inert = false;
    silenced = [];
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Tab') return void opts.onclose();
    const all = items();
    if (!all.length) return;
    const at = all.indexOf(document.activeElement as HTMLElement);
    let next: number;
    if (e.key === 'ArrowDown') next = (at + 1) % all.length;
    else if (e.key === 'ArrowUp') next = (at - 1 + all.length) % all.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = all.length - 1;
    else return;
    e.preventDefault();
    focus(all[next]);
  }

  /* Capture, so focus is back on the button before the item's own click runs. */
  function onclick(e: MouseEvent) {
    if ((e.target as HTMLElement).closest(ITEMS)) {
      release();
      focus(trigger());
    }
  }

  silence();
  focus(items()[0]);
  panel.addEventListener('keydown', onkeydown);
  panel.addEventListener('click', onclick, true);

  return {
    update(next: MenuOptions) {
      const was = !!opts.modal;
      opts = next;
      if (was !== !!opts.modal) silence();
    },
    destroy() {
      panel.removeEventListener('keydown', onkeydown);
      panel.removeEventListener('click', onclick, true);
      window.removeEventListener('keydown', onkey, true);
      window.removeEventListener('pointerdown', onpointer, true);
      release();
      const active = document.activeElement;
      if (!active || active === document.body || panel.contains(active)) focus(trigger());
    }
  };
}
