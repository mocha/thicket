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
