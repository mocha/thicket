/**
 * A post's picture that loaded, but is a tracking pixel: 2 pixels or smaller
 * on a side. The server drops the beacons it knows and the ones a feed says
 * are tiny, but a pixel with no size written anywhere only shows its size
 * once loaded, and on a card it is an empty colored frame.
 */
export function isPixel(e: Event): boolean {
  const img = e.currentTarget as HTMLImageElement;
  return img.naturalWidth <= 2 || img.naturalHeight <= 2;
}

/**
 * Hide tracking pixels inside publisher HTML. Those pictures are inserted as
 * a block, so they cannot have individual Svelte load handlers. Listening on
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
