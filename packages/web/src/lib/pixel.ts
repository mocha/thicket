/**
 * A post's picture that loaded, but is too small to be one: under 100 pixels
 * on a side, the size the server already holds a feed's thumbnail to. A
 * tracking pixel shows as an empty colored frame, and an icon, emoji or avatar
 * stretched across the frame as a blur. The server rules out the ones whose
 * size is written down; this catches the rest, once their real size is known.
 */
const MIN_PICTURE = 100;

export function tooSmallForPicture(e: Event): boolean {
  const img = e.currentTarget as HTMLImageElement;
  return img.naturalWidth < MIN_PICTURE || img.naturalHeight < MIN_PICTURE;
}

/**
 * Hide tracking pixels (2 pixels or smaller) inside publisher HTML. Small
 * images there stay: an icon or emoji in the text is the publisher's own.
 * Those pictures are inserted as a block, so they cannot have individual
 * Svelte load handlers. Listening on
 * their parent in the capture phase still sees each load, and the first pass
 * catches a cached picture that finished before the listener was attached.
 */
export function hidePixelImages(node: HTMLElement) {
  const hide = (img: HTMLImageElement) => {
    if (img.naturalWidth <= 2 || img.naturalHeight <= 2) img.hidden = true;
  };
  const loaded = (e: Event) => {
    if (e.target instanceof HTMLImageElement) hide(e.target);
  };

  node.addEventListener('load', loaded, true);
  for (const img of node.querySelectorAll('img')) {
    if (img.complete) hide(img);
  }

  return { destroy: () => node.removeEventListener('load', loaded, true) };
}
