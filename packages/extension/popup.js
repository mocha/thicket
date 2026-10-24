import { browserApi as api, createClient, saveBookmark, normalizedFeedUrl, membershipLabel, followingSnapshot, siteHost } from './core.js';
const $ = id => document.getElementById(id);
let page, request;
let followed = [], collections = [];
let membershipLoaded = false;
let snapshot;
$('settings').addEventListener('click', event => { event.preventDefault(); api.runtime.openOptionsPage(); });
function updateMembership() {
  const feed = followed.find(f => normalizedFeedUrl(f.url) === normalizedFeedUrl($('feed').value));
  const ids = feed?.myCollectionIds || [];
  const siteIds = [...new Set(followed.flatMap(f => f.myCollectionIds))];
  $('membership').hidden = !membershipLoaded;
  const names = (feed ? ids : siteIds).map(id => collections.find(c => c.id === id)?.name).filter(Boolean);
  $('membership').textContent = feed ? `${membershipLabel(ids, collections)}${ids.length > 1 ? ` · ${names.join(', ')}` : ''}` : siteIds.length ? `Following this site · ${names.join(', ') || membershipLabel(siteIds, collections)}` : 'Not following this feed';
  const inCollection = ids.includes(Number($('collection').value));
  $('follow-button').textContent = inCollection ? membershipLabel(ids, collections) : ids.length ? 'Add to this collection' : 'Follow';
  $('follow-button').disabled = inCollection;
}
$('feed').addEventListener('change', updateMembership);
$('collection').addEventListener('change', updateMembership);
function feedChoices(feeds) {
  $('follow').hidden = !feeds.length || !collections.length;
  $('no-feed').hidden = feeds.length > 0;
  $('feed').replaceChildren(...feeds.map(feed => new Option(`${feed.title || feed.url}${followed.some(f => normalizedFeedUrl(f.url) === normalizedFeedUrl(feed.url)) ? ' · Following' : ''}`, feed.url)));
  updateMembership();
}
async function run(task) {
  const buttons = [...document.querySelectorAll('button')];
  buttons.forEach(button => { button.disabled = true; });
  $('status').textContent = 'Saving…';
  try { await task(); }
  catch (error) { $('status').textContent = error.message; }
  finally { buttons.forEach(button => { button.disabled = false; }); updateMembership(); }
}
$('follow').addEventListener('submit', event => {
  event.preventDefault();
  run(async () => {
    const result = await request('/feeds', 'POST', { url: $('feed').value, collectionId: Number($('collection').value) });
    if (result.status === 'choose') {
      feedChoices(result.candidates);
      $('status').textContent = 'Several feeds are available. Choose one and click Follow.';
    } else if (result.status === 'subscribed') {
      const id = Number($('collection').value);
      const known = followed.find(feed => feed.id === result.feed.id);
      if (known) known.myCollectionIds = [...new Set([...known.myCollectionIds, id])];
      else followed.push({ ...result.feed, myCollectionIds: [id] });
      if (snapshot) {
        const entry = snapshot.feeds.find(feed => feed.id === result.feed.id);
        if (entry) entry.myCollectionIds = [...new Set([...entry.myCollectionIds, id])];
        else snapshot.feeds.push({ ...result.feed, myCollectionIds: [id] });
        await api.storage.local.set({ following: snapshot });
      }
      membershipLoaded = true;
      $('status').textContent = result.alreadyFollowed ? 'Already following · added to this collection.' : 'Following · added to this collection.';
    }
    else {
      feedChoices([]);
      $('status').textContent = '';
    }
  });
});
$('bookmark').addEventListener('submit', event => {
  event.preventDefault();
  run(async () => {
    await saveBookmark(request, page, $('note').value);
    $('status').textContent = 'Bookmark saved.';
  });
});
try {
  const { settings } = await api.storage.local.get('settings');
  if (!settings) throw new Error('Connect your thicket in Connection settings to get started.');
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !/^https?:/.test(tab.url)) throw new Error('Open a web page to follow it or save a bookmark.');
  page = { url: tab.url, title: tab.title || tab.url, feeds: [] };
  try { page = await api.tabs.sendMessage(tab.id, { type: 'discover' }); }
  catch {
    // Also works on tabs opened before installing, with activeTab permission.
    try {
      await api.scripting.executeScript({ target: { tabId: tab.id }, files: ['discovery.js'] });
      page = await api.tabs.sendMessage(tab.id, { type: 'discover' });
    } catch { /* Restricted pages can still be bookmarked by URL. */ }
  }
  $('page').textContent = page.title;
  feedChoices(page.feeds);
  request = createClient(settings);
  const result = await request('/collections');
  collections = result.collections.filter(collection => collection.id !== result.rootId);
  if (!collections.length) {
    $('follow').hidden = true;
  }
  $('collection').replaceChildren(...collections.map(collection => new Option(collection.name, collection.id)));
  feedChoices(page.feeds);
  $('actions').hidden = false;
  try {
    const stored = await api.storage.local.get('following');
    snapshot = stored.following;
    if (!snapshot || Date.now() - snapshot.updatedAt > 5 * 60 * 1000) {
      snapshot = await followingSnapshot(request);
      await api.storage.local.set({ following: snapshot });
    }
    followed = snapshot.feeds.filter(feed => siteHost(feed.siteUrl || feed.url) === siteHost(page.url) || page.feeds.some(candidate => normalizedFeedUrl(candidate.url) === normalizedFeedUrl(feed.url)));
    await api.runtime.sendMessage({ type: 'refresh-badge', tabId: tab.id, url: page.url, feeds: page.feeds });
    membershipLoaded = true;
    // Keep existing follows visible even if a publisher changed its feed link.
    const choices = [...page.feeds];
    for (const feed of followed) if (!choices.some(f => normalizedFeedUrl(f.url) === normalizedFeedUrl(feed.url))) choices.push(feed);
    feedChoices(choices);
    if (followed.length && !page.feeds.length) $('feed').value = followed[0].url;
    updateMembership();
  } catch (error) {
    $('membership').hidden = false;
    $('membership').textContent = `Could not check following: ${error.message}`;
  }
  $('status').textContent = page.feeds.length ? `${page.feeds.length} feed(s) advertised by this page.` : followed.length ? 'Already following this site.' : '';
} catch (error) { $('status').textContent = error.message; }
