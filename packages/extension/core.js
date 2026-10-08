export const browserApi = globalThis.browser || globalThis.chrome;

export function instanceOrigin(value) {
  const url = new URL(value.trim());
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Enter the instance address without a path, query, or credentials.');
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
    throw new Error('Use HTTPS, or HTTP on localhost for development.');
  }
  return url.origin;
}

export function createClient(settings, fetcher = fetch) {
  const origin = instanceOrigin(settings.instance);
  return async (path, method = 'GET', body) => {
    const response = await fetcher(`${origin}/api${path}`, {
      method, credentials: 'omit', redirect: 'error',
      headers: { Authorization: `Bearer ${settings.token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30000),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 404 && data?.status === 'none') return data;
      const retry = response.headers.get('Retry-After');
      throw new Error(`${data?.error || `Request failed (${response.status}).`}${retry ? ` Retry in ${retry} seconds.` : ''}`);
    }
    if (!data) throw new Error('The instance returned an unexpected response.');
    return data;
  };
}

export async function saveBookmark(request, page, note) {
  const saved = await request('/bookmarks', 'POST', { url: page.url, title: page.title });
  if (note.trim()) {
    try { await request(`/bookmarks/${saved.id}/note`, 'PUT', { body: note.trim() }); }
    catch (error) { throw new Error(`Bookmark saved, but the note was not saved: ${error.message}`); }
  }
  return saved;
}

export function normalizedFeedUrl(value) {
  try {
    const url = new URL(value);
    url.hash = '';
    url.hostname = url.hostname.replace(/^www\./, '');
    return url.href.replace(/\/$/, '');
  } catch { return ''; }
}

export function membershipLabel(ids, collections) {
  const unique = [...new Set(ids)];
  if (!unique.length) return 'Follow';
  const only = unique.length === 1 && collections.find(c => c.id === unique[0]);
  return only ? `In ${only.name}` : `In ${unique.length} collection${unique.length === 1 ? '' : 's'}`;
}

export function siteHost(value) {
  try { return new URL(value).hostname.replace(/^www\./, ''); }
  catch { return ''; }
}

export async function followingSnapshot(request) {
  const feeds = [];
  let offset = 0;
  do {
    const result = await request(`/feeds?following=1&limit=200&offset=${offset}`);
    feeds.push(...result.feeds.map(({ id, url, siteUrl, title, myCollectionIds }) => ({ id, url, siteUrl, title, myCollectionIds })));
    offset = result.nextOffset;
  } while (offset != null);
  return { feeds, updatedAt: Date.now() };
}
