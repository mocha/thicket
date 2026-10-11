// Runs only in the top frame. No API credentials or network requests here.
(() => {
  if (globalThis.__thicketDiscoveryInstalled) return;
  globalThis.__thicketDiscoveryInstalled = true;
  function discover() {
    const feeds = new Map();
    const types = new Set(['application/rss+xml', 'application/atom+xml', 'application/feed+json', 'application/json']);
    for (const link of (document.head || document).querySelectorAll('link[rel~="alternate"][href]')) {
      if (!types.has((link.type || '').toLowerCase().split(';')[0].trim())) continue;
      try {
        const url = new URL(link.getAttribute('href'), document.baseURI);
        if (!['http:', 'https:'].includes(url.protocol)) continue;
        url.hash = '';
        feeds.set(url.href, { url: url.href, title: link.title || url.href });
      } catch { /* Ignore malformed publisher markup. */ }
    }
    const root = document.documentElement;
    if (root && ['rss', 'feed', 'RDF'].includes(root.localName)) {
      feeds.set(location.href, { url: location.href, title: document.title || 'Feed' });
    }
    return { url: location.href, title: document.title, feeds: [...feeds.values()] };
  }
  const api = globalThis.browser || globalThis.chrome;
  api.runtime.onMessage.addListener(message => {
    if (message.type === 'discover') return Promise.resolve(discover());
  });
  const page = discover();
  api.runtime.sendMessage({ type: 'feeds-discovered', ...page }).catch(() => {});
})();
