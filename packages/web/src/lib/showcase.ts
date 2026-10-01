import { api, exploreApi, type RiverItem } from '$lib/api';

/**
 * Real, current posts for the landing page's pictures: the newest few from
 * the first three starter collections (the ones in "Peek inside"), mixed
 * newest first the way Everything mixes them. `pictures` keeps only posts
 * that have one.
 *
 * News collections are skipped, judged by name, so the picture stays neutral
 * rather than leading with politics. If every starter collection looks like
 * news, it uses them anyway rather than show an empty picture.
 */
const NEWSY = /\bnews\b|politic|\bworld\b/i;

export async function showcasePosts(count: number, { pictures = false } = {}): Promise<RiverItem[]> {
  const r = await exploreApi.featured();
  const calm = r.collections.filter((c) => !NEWSY.test(c.name));
  const pick = (calm.length ? calm : r.collections).slice(0, 3);
  const pages = await Promise.all(pick.map((c) => api.river({ collection: c.id, limit: 8 }).catch(() => null)));
  const seen = new Set<number>();
  return pages
    .flatMap((p) => p?.items ?? [])
    .filter((i) => (!pictures || !!i.imageUrl) && !seen.has(i.id) && !!seen.add(i.id))
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, count);
}
