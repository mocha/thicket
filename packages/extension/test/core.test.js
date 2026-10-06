import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { instanceOrigin, createClient, saveBookmark } from '../core.js';

test('instance validation prevents credentials being sent to insecure or ambiguous addresses', () => {
  assert.equal(instanceOrigin(' https://readthicket.com/ '), 'https://readthicket.com');
  assert.equal(instanceOrigin('http://localhost:5173'), 'http://localhost:5173');
  for (const value of ['http://example.com', 'https://a:b@example.com', 'https://example.com/path', 'https://example.com/?x=1', 'ftp://example.com']) {
    assert.throws(() => instanceOrigin(value));
  }
});

test('API sends bearer token only to configured instance without cookies or redirects', async () => {
  const request = createClient({ instance: 'https://example.com', token: 'secret' }, async (url, options) => {
    assert.equal(url, 'https://example.com/api/feeds');
    assert.equal(options.headers.Authorization, 'Bearer secret');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'error');
    assert.deepEqual(JSON.parse(options.body), { url: 'https://publisher.com', collectionId: 7 });
    return Response.json({ status: 'choose', candidates: [] });
  });
  assert.equal((await request('/feeds', 'POST', { url: 'https://publisher.com', collectionId: 7 })).status, 'choose');
});

test('API handles discovery misses, rate limits and non-JSON errors', async () => {
  const settings = { instance: 'https://example.com', token: 'secret' };
  assert.equal((await createClient(settings, async () => Response.json({ status: 'none' }, { status: 404 }))('/feeds')).status, 'none');
  await assert.rejects(createClient(settings, async () => Response.json({ error: 'Too many requests.' }, { status: 429, headers: { 'Retry-After': '10' } }))('/collections'), /Retry in 10 seconds/);
  await assert.rejects(createClient(settings, async () => new Response('Bad gateway', { status: 502 }))('/collections'), /502/);
});

test('bookmark notes use the returned bookmark ID, and partial saves are explicit', async () => {
  const calls = [];
  const request = async (...args) => { calls.push(args); return { id: 42 }; };
  await saveBookmark(request, { url: 'https://publisher.com/post', title: 'A post' }, ' My note ');
  assert.deepEqual(calls, [['/bookmarks', 'POST', { url: 'https://publisher.com/post', title: 'A post' }], ['/bookmarks/42/note', 'PUT', { body: 'My note' }]]);
  await assert.rejects(saveBookmark(async (path) => {
    if (path.endsWith('/note')) throw new Error('Rate limited');
    return { id: 42 };
  }, { url: 'https://publisher.com' }, 'note'), /Bookmark saved, but the note was not saved/);
});

test('discovery resolves relative links, rejects unsafe links, and deduplicates feeds', async () => {
  let discovered;
  let listener;
  const link = (href, type, title = '') => ({ type, title, getAttribute: () => href });
  const context = {
    URL, location: { href: 'https://publisher.com/post' },
    document: {
      baseURI: 'https://publisher.com/blog/', title: 'A post', documentElement: { localName: 'html' },
      querySelectorAll: () => [link('../feed#one', 'application/rss+xml', 'RSS'), link('../feed#two', 'application/atom+xml', 'Atom'), link('/feed.json', 'application/feed+json'), link('javascript:alert(1)', 'application/rss+xml'), link('/not-a-feed', 'text/html')],
    },
    browser: { runtime: { onMessage: { addListener: fn => { listener = fn; } }, sendMessage: async message => { discovered = message; } } },
  };
  vm.runInNewContext(await readFile(new URL('../discovery.js', import.meta.url), 'utf8'), context);
  assert.deepEqual(Array.from(discovered.feeds, feed => feed.url), ['https://publisher.com/feed', 'https://publisher.com/feed.json']);
  assert.equal((await listener({ type: 'discover' })).title, 'A post');
});

test('membership labels match the app and URL matching tolerates www and fragments', async () => {
  const { membershipLabel, normalizedFeedUrl } = await import('../core.js');
  const collections = [{ id: 7, name: 'Tech News' }];
  assert.equal(membershipLabel([], collections), 'Follow');
  assert.equal(membershipLabel([7], collections), 'In Tech News');
  assert.equal(membershipLabel([7, 8, 7], collections), 'In 2 collections');
  assert.equal(normalizedFeedUrl('https://www.arstechnica.com/feed/#rss'), normalizedFeedUrl('https://arstechnica.com/feed'));
});

test('automatic page discovery is idempotent and sends only one message and installs one listener', async () => {
  const source = await readFile(new URL('../discovery.js', import.meta.url), 'utf8');
  let messages = 0, listeners = 0, scans = 0;
  const context = {
    URL, location: { href: 'https://example.com' },
    document: { title: 'No feeds', head: { querySelectorAll: () => { scans++; return []; } }, documentElement: { localName: 'html' } },
    browser: { runtime: { onMessage: { addListener: () => { listeners++; } }, sendMessage: async () => { messages++; } } },
  };
  vm.runInNewContext(source, context);
  vm.runInNewContext(source, context);
  assert.equal(scans, 1);
  assert.equal(listeners, 1);
  assert.equal(messages, 1);
});

test('automatic discovery registers once and can be fully unregistered', async () => {
  let registered = [], registrations = 0;
  const context = { browser: { scripting: {
    getRegisteredContentScripts: async () => registered,
    registerContentScripts: async scripts => { registered = scripts; registrations++; },
    unregisterContentScripts: async () => { registered = []; },
  } } };
  vm.runInNewContext(await readFile(new URL('../automatic.js', import.meta.url), 'utf8'), context);
  await context.configureThicketDiscovery(true);
  await context.configureThicketDiscovery(true);
  assert.equal(registrations, 1);
  assert.equal(registered[0].runAt, 'document_idle');
  await context.configureThicketDiscovery(false);
  assert.equal(registered.length, 0);
});

test('following snapshot paginates and stores only fields needed for local matching', async () => {
  const { followingSnapshot } = await import('../core.js');
  const calls = [];
  const result = await followingSnapshot(async path => {
    calls.push(path);
    return calls.length === 1 ? { feeds: [{ id: 1, url: 'https://deuley.ltd/feed', siteUrl: 'https://deuley.ltd', title: 'Blog', myCollectionIds: [7], description: 'Unneeded' }], nextOffset: 200 } : { feeds: [], nextOffset: null };
  });
  assert.equal(result.feeds.length, 1);
  assert.equal(result.feeds[0].description, undefined);
  assert.match(calls[0], /following=1/);
  assert.match(calls[1], /offset=200/);
});

test('background paints cached follows as checkmarks without fetching during navigation', async () => {
  const source = await readFile(new URL('../background.js', import.meta.url), 'utf8');
  let listener, changed, removed, updated;
  const badges = [], icons = [];
  const stored = { following: { feeds: [{ url: 'https://deuley.ltd/feed', siteUrl: 'https://deuley.ltd/' }] } };
  const context = {
    URL, console,
    configureThicketDiscovery: async () => {},
    fetch: () => { throw new Error('No navigation network calls allowed'); },
    browser: {
      action: { setIcon: async args => icons.push(args), setBadgeText: async args => badges.push(args), setBadgeBackgroundColor: async () => {}, setTitle: async () => {} },
      storage: { local: { get: async () => stored }, onChanged: { addListener: fn => { changed = fn; } } },
      runtime: { onMessage: { addListener: fn => { listener = fn; } } },
      tabs: { onUpdated: { addListener: fn => { updated = fn; } }, onRemoved: { addListener: fn => { removed = fn; } } },
      permissions: { contains: async () => true },
    },
  };
  vm.runInNewContext(source, context);
  await listener({ type: 'feeds-discovered', url: 'https://www.deuley.ltd/post', feeds: [{ url: 'https://deuley.ltd/feed' }, { url: 'https://deuley.ltd/atom' }] }, { frameId: 0, tab: { id: 3 } });
  assert.equal(badges.at(-1).text, '✓');
  assert.equal(icons.at(-1).path, 'icon.svg');
  await listener({ type: 'feeds-discovered', url: 'https://another.blog', feeds: [{ url: 'https://another.blog/feed' }] }, { frameId: 0, tab: { id: 4 } });
  assert.equal(badges.at(-1).text, '1');
  await listener({ type: 'feeds-discovered', url: 'https://no-feed.example', feeds: [] }, { frameId: 0, tab: { id: 5 } });
  assert.equal(badges.at(-1).text, '');
  assert.equal(icons.at(-1).path, 'icon-grey.svg');
  changed({ following: { newValue: { feeds: [] } } }, 'local');
  assert.equal(badges.findLast(badge => badge.tabId === 3).text, '2');
  updated(3, { status: 'loading' });
  assert.equal(badges.at(-1).text, '');
  removed(4);
});
