/**
 * Did the reader arrive by keyboard, or by mouse or finger?
 *
 * A text field is typed into, so the browser treats a plain mouse click on one
 * as a keyboard focus — :focus-visible matches either way. That is why
 * clicking a field used to draw the heavy focus ring meant for people tabbing
 * through the page. We watch the last thing the reader actually did instead: a
 * key press means keyboard, a tap or click means pointer.
 *
 * Fields read this once, the moment focus lands, and keep the answer — so
 * typing in a field you clicked does not suddenly light the ring up.
 */
let keyboard = $state(false);

if (typeof window !== 'undefined') {
  // Capture, so a component that swallows the event still moves the flag.
  window.addEventListener('keydown', () => (keyboard = true), true);
  window.addEventListener('pointerdown', () => (keyboard = false), true);
}

export const modality = {
  get keyboard() {
    return keyboard;
  }
};
