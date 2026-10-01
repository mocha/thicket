/**
 * One toast at a time, optionally with an undo action. Cheap undo is the product's primary safety net.
 *
 * A plain toast stays 6 seconds. One with a button (Undo, Open) stays 10, so
 * there is time to read it and get to the button. Either way the countdown
 * waits while the pointer or keyboard focus is on the toast, and starts over
 * when it leaves: nobody loses an Undo while they are reaching for it.
 */
type Toast = { id: number; message: string; action?: { label: string; run: () => void | Promise<void> } };
let counter = 0;
export const toast = $state<{ current: Toast | null }>({ current: null });
let timer: ReturnType<typeof setTimeout> | undefined;
let lasts = 0;

const PLAIN_MS = 6000;
const ACTION_MS = 10000;

export function showToast(message: string, action?: Toast['action'], ms = action ? ACTION_MS : PLAIN_MS) {
  clearTimeout(timer);
  toast.current = { id: ++counter, message, action };
  lasts = ms;
  timer = setTimeout(() => (toast.current = null), ms);
}
export function dismissToast() {
  clearTimeout(timer);
  toast.current = null;
}
/** The pointer or focus is on the toast: stop the countdown. */
export function holdToast() {
  clearTimeout(timer);
}
/** It has left: count down again from the start. */
export function releaseToast() {
  clearTimeout(timer);
  if (toast.current) timer = setTimeout(() => (toast.current = null), lasts);
}
