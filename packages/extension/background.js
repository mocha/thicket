const api = globalThis.browser || globalThis.chrome;
let following = { feeds: [] };
let enabled = true;
const badges = new Map();
function host(value) {
  try { return new URL(value).hostname.replace(/^www\./, ''); }
  catch { return ''; }
}
function canonical(value) {
  try {
    const url = new URL(value); url.hash = ''; url.hostname = host(value);
    return url.href.replace(/\/$/, '');
  } catch { return ''; }
}
function paint(tabId, page) {
  const followed = following.feeds.some(feed => host(feed.siteUrl || feed.url) === host(page.url) || (page.feeds || []).some(candidate => canonical(candidate.url) === canonical(feed.url)));
  const count = page.count ?? page.feeds?.length ?? 0;
  api.action.setIcon({ tabId, path: followed || count ? 'icon.svg' : 'icon-grey.svg' }).catch(() => {});
  api.action.setBadgeText({ tabId, text: followed ? '✓' : count ? String(count) : '' }).catch(() => {});
  api.action.setBadgeBackgroundColor({ tabId, color: '#305b43' }).catch(() => {});
  api.action.setTitle({ tabId, title: followed ? 'thicket · Following this site' : count ? `thicket · ${count} feeds available` : 'thicket' }).catch(() => {});
}
const ready = api.storage.local.get(['following', 'automaticDetection']).then(stored => {
  following = stored.following || { feeds: [] };
  enabled = stored.automaticDetection !== false;
});
api.runtime.onMessage.addListener((message, sender) => {
  if (message.type === 'feeds-discovered' && sender.tab && sender.frameId === 0) {
    return ready.then(() => {
      if (!enabled) return;
      badges.set(sender.tab.id, message);
      paint(sender.tab.id, message);
    });
  }
  if (message.type === 'refresh-badge' && !sender.tab) {
    return ready.then(async () => {
      const stored = await api.storage.local.get('following');
      following = stored.following || { feeds: [] };
      badges.set(message.tabId, message);
      paint(message.tabId, message);
    });
  }
});
api.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.automaticDetection) enabled = changes.automaticDetection.newValue !== false;
  if (changes.following) {
    following = changes.following.newValue || { feeds: [] };
    for (const [tabId, page] of badges) paint(tabId, page);
  }
});
api.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === 'loading') {
    badges.delete(tabId);
    api.action.setIcon({ tabId, path: 'icon-grey.svg' }).catch(() => {});
    api.action.setBadgeText({ tabId, text: '' }).catch(() => {});
    api.action.setTitle({ tabId, title: 'thicket' }).catch(() => {});
  }
});
api.tabs.onRemoved.addListener(tabId => badges.delete(tabId));
async function restoreDiscovery() {
  await ready;
  const permitted = await api.permissions.contains({ origins: ['https://*/*', 'http://*/*'] });
  await globalThis.configureThicketDiscovery(enabled && permitted);
}
restoreDiscovery().catch(error => console.warn('thicket: automatic discovery setup failed', error.message));
