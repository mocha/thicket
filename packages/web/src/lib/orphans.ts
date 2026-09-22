/**
 * Keep a title's last two words together.
 *
 * A headline whose final word wraps onto a line of its own reads as a
 * mistake. `text-wrap: pretty` asks the browser to avoid that, but it is
 * ignored inside a clamped block and unsupported in some browsers, so this
 * does it by hand: the last space becomes a non-breaking one. Short titles
 * (one or two words) come back unchanged.
 */
export function noOrphan(text: string | null | undefined): string {
  if (!text) return text ?? '';
  const i = text.trimEnd().lastIndexOf(' ');
  if (i <= 0) return text;
  return text.slice(0, i) + ' ' + text.slice(i + 1);
}
