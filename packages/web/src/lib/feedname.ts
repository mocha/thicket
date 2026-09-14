import { hostOf } from './time';

type Named = { title: string | null; url: string; displayName?: string | null };

/**
 * A feed's name as this reader sees it. Inside a feed — its page, a river —
 * the reader's own name for it simply replaces the title.
 */
export function feedName(f: Named): string {
  return f.displayName ?? f.title ?? hostOf(f.url);
}

/**
 * Where feeds are listed to be found, chosen or managed, the original stays
 * beside the reader's name: "My name (Original name)". A renamed feed is then
 * still recognisable by what everyone else calls it.
 */
export function feedListName(f: Named): string {
  const original = f.title ?? hostOf(f.url);
  return f.displayName ? `${f.displayName} (${original})` : original;
}
