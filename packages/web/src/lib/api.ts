/** The only file that knows the API's shape. UI components import from here. */
import type { Display } from './display.svelte';
/**
 * My note on a post. One per post; edits keep createdAt and move updatedAt. A
 * note is part of a bookmark (issue #84), so its id is the bookmark's.
 */
export type Note = { id: number; body: string; createdAt: string; updatedAt: string;
  /** The people the note @mentions who have an account, lowercase, so their names can link to them (issue #184). */
  mentions?: string[] };
/** A note just written: writing one saves the post, so this says which bookmark holds it. */
export type SavedNote = Note & { bookmarkId: number };
export type PublicNote = Note & { author: { handle: string; displayName: string | null; avatarUpdatedAt?: string | null } };
export type RiverItem = {
  id: number; feedId: number; feedTitle: string | null; siteUrl: string | null;
  /** The feed's slug, so a card can write the post's address without another fetch. */
  feedSlug: string;
  url: string | null; title: string | null; author: string | null; summary: string | null;
  /** When the whole feed description was just a link elsewhere (e.g. Hacker News's "Comments"), that link and its words, to show in place of a summary. */
  linkUrl: string | null; linkLabel: string | null;
  imageUrl: string | null; publishedAt: string; hasIcon: boolean; bookmarkId: number | null;
  myNote: Note | null;
  /** Other people's notes the viewer is allowed to see, newest first. */
  notes: PublicNote[];
  /** Earlier posts on the same feed this one appears to repeat, newest first. Absent outside the river. */
  repeatOf?: { id: number; publishedAt: string; url: string | null; title: string | null }[];
};
/**
 * `cappedAt` is set when the reader is a visitor without an account, the
 * instance holds visitors to its newest items, and there were more than this
 * page. The number is that limit. No next page comes after it.
 */
/** One collection's "what's new": posts newer than the point this device sent, counted up to 100 (`more` past that), and its posts in the last week. */
export type Mark = { collectionId: number; count: number; more: boolean; weekly: number };
export type RiverPage = { items: RiverItem[]; nextCursor: string | null; hidden: number; cappedAt?: number | null };

/**
 * A post fetched on its own, by its address rather than out of a list. Same
 * shape as a river item minus the list-only extras, and readable signed out —
 * the body is a separate, members-only fetch.
 */
export type ItemRef = RiverItem;

/** A post's body for the in-app reader, sanitized on the server (api/src/lib/sanitize.ts). */
export type ItemContent = {
  id: number; feedId: number; url: string | null; title: string | null; author: string | null; publishedAt: string;
  feedTitle: string | null; siteUrl: string | null;
  html: string; hasImages: boolean; textLength: number;
  /** Median text length of this feed's recent posts, for telling a teaser from a post. */
  typicalLength: number | null;
  /** The server's guess that this is a teaser, not the whole post. */
  partial: boolean;
};

export type Feed = {
  id: number; url: string; siteUrl: string | null; title: string | null; description: string | null; kind: string; slug: string;
  lastFetchedAt: string | null; nextFetchAt: string; fetchIntervalS: number;
  consecutiveFailures: number; lastStatus: number | null; lastError: string | null; lastItemAt: string | null; createdAt: string;
  hasIcon: boolean; itemCount: number; postsLast30d: number; followerCount: number;
  /** How many feeds on this instance share this title. >1 = show the feed path, not just the site. */
  sameTitle: number;
  /** Collections of the current user that hold this feed. Empty = not following. */
  myCollectionIds: number[]; blocked: boolean;
  /** With ?network=, how many people in that network follow it. */
  networkFollowers?: number | null;
  /** The caller's own settings on this feed (feed_settings). Nobody else sees them. */
  displayName: string | null;
  /** Whether Shorts are left out for me, all things considered: this feed's setting, else my default. */
  hideShorts: boolean;
  /** What I set on this feed itself: true hide, false show, null follow my default. */
  hideShortsSetting: boolean | null;
  /** A YouTube feed, which is what makes the Shorts setting available. */
  isYouTube: boolean;
  /** Posts from the last 30 days that appear to repeat an earlier post from this feed. */
  repeatsLast30d: number;
  /** Conditional-GET state, shown on the settings page for diagnosing a feed. */
  etag: string | null; lastModified: string | null;
};
export type FeedSettings = { feedId: number; displayName: string | null; hideShorts: boolean; hideShortsSetting: boolean | null };
export type FeedIndexPage = { feeds: Feed[]; total: number; indexTotal: number; nextOffset: number | null };

export type Collection = { id: number; parentId: number | null; name: string; slug: string; description: string | null; feedCount: number; visibility: ShareLevel };

export type SubscribeOutcome =
  | { status: 'subscribed'; feed: Feed; alreadyFollowed: boolean; waiting?: boolean }
  | { status: 'choose'; candidates: { url: string; title: string | null; kind: string | null; note?: string | null }[] }
  | { status: 'none'; pageUrl: string }
  | { error: string };

/** Thrown for non-2xx responses; `field` names the form field when the server says which. */
export class ApiError extends Error {
  constructor(message: string, public status: number, public field?: string) { super(message); }
}

let onUnauthorized: (() => void) | null = null;
/** The session store registers here so an expired cookie anywhere signs the app out. */
export function setUnauthorizedHandler(fn: () => void) { onUnauthorized = fn; }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * What to tell someone when the server refused without saying why: a plain
 * sentence, with the status number at the end so support can tell the cases
 * apart. A 502, 503, or 504 is the proxy in front saying the server itself
 * didn't answer (a deploy, a restart, an outage).
 */
export function failureText(status: number): string {
  if (status === 502 || status === 503 || status === 504) return `The server isn’t answering right now. Try again in a minute. (Error ${status})`;
  if (status >= 500) return `Something went wrong on the server. Try again in a minute. (Error ${status})`;
  if (status === 404) return `That isn’t here anymore. Reload the page and try again. (Error 404)`;
  return `That didn’t work. Reload the page and try again. (Error ${status})`;
}
/** When the request never reached the server at all. */
export const OFFLINE_TEXT = 'Can’t reach the server. Check your connection and try again.';

/** fetch, with a failure to connect said in words instead of the browser's own "Failed to fetch". */
async function reach(input: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (e) {
    console.error('Request failed before reaching the server', input, e);
    throw new ApiError(OFFLINE_TEXT, 0);
  }
}

async function j<T>(input: string, init?: RequestInit): Promise<T> {
  let res = await reach(input, { headers: { 'content-type': 'application/json' }, ...init });
  // A 429 comes from one of two places. A proxy in front dropped the request before the server saw
  // it: safe to retry any method, so back off 0.5s, 1s, 2s, 4s with jitter, honoring Retry-After if
  // present. Or thicket itself said "that's enough" (too many sign-in tries, a day's worth of saving):
  // its refusals carry their reason as JSON `error`, and asking again would only delay showing it.
  const ownRefusal = async (r: Response) => typeof (await r.clone().json().catch(() => null))?.error === 'string';
  for (let attempt = 0; res.status === 429 && attempt < 4 && !(await ownRefusal(res)); attempt++) {
    const hinted = Number(res.headers.get('retry-after') ?? 0) * 1000;
    await sleep(Math.min(6000, hinted || 500 * 2 ** attempt) + Math.random() * 300);
    res = await reach(input, { headers: { 'content-type': 'application/json' }, ...init });
  }
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) onUnauthorized?.();
  if (!res.ok && !body.error) console.error('Request failed with no reason given', input, res.status);
  if (!res.ok && !('status' in body)) throw new ApiError(body.error ?? failureText(res.status), res.status, body.field);
  return body as T;
}

export const api = {
  river: (opts: { before?: string | null; collection?: number | null; feed?: number | null; limit?: number } = {}) => {
    const q = new URLSearchParams();
    if (opts.before) q.set('before', opts.before);
    if (opts.collection) q.set('collection', String(opts.collection));
    if (opts.feed) q.set('feed', String(opts.feed));
    if (opts.limit) q.set('limit', String(opts.limit));
    return j<RiverPage>(`/api/river?${q}`);
  },
  /** What you follow and what arrived today, for the top of New posts. */
  riverStats: () => j<{ feeds: number; collections: number; posts24h: number; feeds24h: number }>('/api/river/stats'),
  /** What's new: how many posts are newer than each point this device remembers. The server keeps nothing. */
  marksCounts: (anchors: Record<string, string>) => j<{ marks: Mark[]; seen: Record<number, string> }>('/api/marks/counts', { method: 'POST', body: JSON.stringify({ anchors }) }),
  feeds: (opts: { q?: string; following?: '1' | '0' | null; network?: '1' | '2' | null; since?: string | null; sort?: string; limit?: number; offset?: number } = {}) => {
    const q = new URLSearchParams();
    if (opts.q) q.set('q', opts.q);
    if (opts.following) q.set('following', opts.following);
    if (opts.network) q.set('network', opts.network);
    if (opts.since) q.set('since', opts.since);
    if (opts.sort) q.set('sort', opts.sort);
    if (opts.limit) q.set('limit', String(opts.limit));
    if (opts.offset) q.set('offset', String(opts.offset));
    return j<FeedIndexPage>(`/api/feeds?${q}`);
  },
  feed: (id: number) => j<Feed>(`/api/feeds/${id}`),
  /** My settings on a feed. Send only what changes. */
  /** hideShorts: true hides them on this channel, false shows them, null follows my default. */
  feedSettings: (id: number, patch: { displayName?: string | null; hideShorts?: boolean | null }) => j<FeedSettings>(`/api/feeds/${id}/settings`, { method: 'PUT', body: JSON.stringify(patch) }),
  /** `newCollection`: a name for a collection to start with this feed, when none is picked. Someone with no collections must give one. */
  follow: (id: number, to: { collectionId?: number; newCollection?: string } = {}) => j<{ feedId: number; collectionIds: number[] }>(`/api/feeds/${id}/follow`, { method: 'POST', body: JSON.stringify(to) }),
  addFeed: (url: string, collectionIds: number[] = [], newCollection?: string) => j<SubscribeOutcome>('/api/feeds', { method: 'POST', body: JSON.stringify({ url, collectionIds, newCollection }) }),
  unfollow: (id: number) => j<{ feedId: number; collectionIds: number[] }>(`/api/feeds/${id}`, { method: 'DELETE' }),
  restore: (id: number, collectionIds: number[]) => j<{ feedId: number; collectionIds: number[] }>(`/api/feeds/${id}/restore`, { method: 'POST', body: JSON.stringify({ collectionIds }) }),
  /** Refresh is rate-limited per feed; a 429 comes back as { cooldown: seconds } instead of throwing. */
  /** `reason` is set when the feed's whole site is paused (it asked thicket to slow down, or seems down), rather than this feed being fetched recently. */
  /** `feedId` differs from `id` when the fetch showed this feed to be another feed's address and it was folded into that one. */
  refresh: async (id: number): Promise<{ ok: true; feedId: number } | { ok: false; cooldown: number; reason: string | null }> => {
    const res = await reach(`/api/feeds/${id}/refresh`, { method: 'POST' });
    if (res.status === 429) { const b = await res.json().catch(() => ({})); return { ok: false, cooldown: Number(b.retryAfterS ?? 300), reason: b.reason ?? null }; }
    if (!res.ok) throw new ApiError(failureText(res.status), res.status);
    const b = await res.json().catch(() => ({}));
    return { ok: true, feedId: Number(b.feedId ?? id) };
  },
  collections: () => j<{ collections: Collection[]; rootId: number }>('/api/collections'),
  event: (kind: string, payload: Record<string, unknown> = {}) => {
    // Fire and forget; analytics must never slow the UI or surface errors.
    void fetch('/api/events', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind, payload }), keepalive: true }).catch(() => {});
  }
};

export type CollectionFeed = {
  id: number; url: string; siteUrl: string | null; title: string | null; kind: string;
  consecutiveFailures: number; lastError: string | null; lastStatus: number | null;
  lastFetchedAt: string | null; lastItemAt: string | null; addedAt: string | null; hasIcon: boolean; sameTitle: number;
  /** My own name for this feed, if I gave it one. */
  displayName: string | null;
};
export type CollectionDetail = Collection & { userId: number; feeds: CollectionFeed[]; children: Collection[] };
export type ImportResult = { feeds: number; collections: number; skipped: string[] };

export const collectionsApi = {
  get: (id: number) => j<CollectionDetail>(`/api/collections/${id}`),
  /** Feeds that would stop being followed if this collection were deleted. */
  orphans: (id: number) => j<{ feeds: { id: number; title: string | null; url: string; siteUrl: string | null; slug: string; hasIcon: boolean }[] }>(`/api/collections/${id}/orphans`),
  create: (name: string, parentId?: number) => j<Collection>('/api/collections', { method: 'POST', body: JSON.stringify({ name, parentId }) }),
  update: (id: number, patch: { name?: string; description?: string; parentId?: number; visibility?: ShareLevel }) => j<Collection>(`/api/collections/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  remove: (id: number) => j<{ deleted: number }>(`/api/collections/${id}`, { method: 'DELETE' }),
  /** Merge this collection into another of mine: that one keeps its name and gains these feeds and sub-collections; this one is deleted. */
  merge: (id: number, intoId: number) => j<{ into: { id: number; name: string; slug: string }; added: number; movedChildren: number }>(`/api/collections/${id}/merge`, { method: 'POST', body: JSON.stringify({ intoId }) }),
  removeFeed: (id: number, feedId: number) => j<unknown>(`/api/collections/${id}/feeds/${feedId}`, { method: 'DELETE' }),
  addFeed: (id: number, feedId: number) => j<unknown>(`/api/collections/${id}/feeds/${feedId}`, { method: 'PUT' }),
  setFeedCollections: (feedId: number, collectionIds: number[]) => j<{ feedId: number; collectionIds: number[] }>(`/api/feeds/${feedId}/collections`, { method: 'PUT', body: JSON.stringify({ collectionIds }) }),
  opmlUrl: (id: number) => `/api/collections/${id}/opml`,
  /** Copy a collection from anywhere: a thicket collection page on any instance, or an OPML URL. */
  importUrl: (url: string) => j<ImportResult & { collection: Collection }>('/api/collections/import-url', { method: 'POST', body: JSON.stringify({ url }) }),
  importOpml: async (id: number, file: File): Promise<ImportResult> => {
    const res = await reach(`/api/collections/${id}/import`, { method: 'POST', headers: { 'content-type': 'text/x-opml' }, body: await file.text() });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(body.error ?? failureText(res.status), res.status);
    return body as ImportResult;
  }
};

/** The import page (api/src/lib/importer.ts). `unsure`: couldn't be checked just now; it is added and retried. */
export type ImportFeedState = 'ok' | 'failed' | 'unsure' | 'pending';
/** `retry`: this verdict could change if we ask again shortly — a timeout or a brief 5xx, never a 429 or a paused host. */
export type ImportFeed = { url: string; title: string | null; siteUrl: string | null; state: ImportFeedState; reason: string | null; retry: boolean };
export type ImportGroup = { name: string; feeds: ImportFeed[]; existing: { id: number; name: string; slug: string } | null };
export type ImportPreview = { title: string | null; source: string | null; groups: ImportGroup[]; emptyFolders: string[]; duplicates: number };
export type ImportCheck = { url: string; state: ImportFeedState; reason: string | null; title: string | null; finalUrl: string | null; retry: boolean };
/** `renamedFrom`: the folder's name in the file, when the new collection had to be numbered past one of mine. */
export type ImportCommitted = { id: number; name: string; slug: string; renamedFrom: string | null; added: number };
/** Feeds per check request; the server takes no more. */
export const IMPORT_CHECK_BATCH = 8;

/** Read and check go around j(): they answer 429 when someone is checking far too much, and that must not be retried. */
async function raw<T>(input: string, init: RequestInit): Promise<T> {
  const res = await reach(input, init);
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) onUnauthorized?.();
  if (!res.ok) throw new ApiError(body.error ?? failureText(res.status), res.status);
  return body as T;
}

export const importApi = {
  readFile: async (file: File) => raw<ImportPreview>('/api/import/read', { method: 'POST', headers: { 'content-type': 'text/x-opml' }, body: await file.text() }),
  readLink: (url: string) => raw<ImportPreview>('/api/import/read', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url }) }),
  check: (urls: string[]) => raw<{ results: ImportCheck[] }>('/api/import/check', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ urls }) }),
  commit: (groups: { name: string; feeds: { url: string; title: string | null }[] }[]) =>
    j<{ collections: ImportCommitted[] }>('/api/import/commit', { method: 'POST', body: JSON.stringify({ groups }) }),
};

/** A saved post, as the Bookmarks pages list it: its own copy of the post, and the note on it if any. */
export type Bookmark = {
  id: number; itemId: number | null; feedId: number | null; url: string; title: string | null; summary: string | null;
  /** The source post's discussion-style link (e.g. Hacker News's "Comments"), read live from the item, if it still exists. */
  linkUrl: string | null; linkLabel: string | null;
  imageUrl: string | null; siteTitle: string | null; author: string | null; publishedAt: string | null;
  savedAt: string; hasIcon: boolean;
  /** When it last saw activity: saved, or its note written or edited. What the list sorts on. */
  activeAt: string;
  /** The list owner's note on it: mine on my profile, theirs on someone's profile (when they share notes with me). */
  note: Note | null;
  /** Other people's notes on the same post that I may read. My own list only. */
  notes?: PublicNote[];
  /**
   * Where a search matched, on a searched list only: each field's text with
   * the matched words fenced for `highlight` (lib/words.ts), or null when the
   * match is not in that field. The summary is cut to the part around the match.
   */
  marks?: { title: string | null; site: string | null; summary: string | null; note: string | null } | null;
};
/** A bookmark as saving or removing one returns it: the stored row, note fields flat. Pass it back to `restore` to undo a removal. */
export type BookmarkRow = {
  id: number; itemId: number | null; feedId: number | null; url: string; title: string | null; summary: string | null;
  imageUrl: string | null; siteTitle: string | null; author: string | null; publishedAt: string | null; savedAt: string;
  note: string | null; noteCreatedAt: string | null; noteUpdatedAt: string | null;
};
export const NOTE_MAX = 2000;
/** Notes by the post they are on. Writing one saves the post if it isn't saved yet; deleting one keeps the bookmark. */
export const notesApi = {
  write: (itemId: number, body: string) => j<SavedNote>(`/api/notes/items/${itemId}`, { method: 'PUT', body: JSON.stringify({ body }) }),
  remove: (itemId: number) => j<void>(`/api/notes/items/${itemId}`, { method: 'DELETE' }),
};

// ---- notifications (issue #184) ----------------------------------------------

/** Who a notification is about. */
export type NotificationPerson = { handle: string; displayName: string | null; avatarUpdatedAt: string | null };
/** A post, as a one-line notification names it. */
export type NotificationPost = { url: string; title: string | null; siteTitle: string | null; feedId: number | null; hasIcon: boolean };
/**
 * One thing that happened, newest first. Derived on the server from follows,
 * bookmarks and notes, so anything undone simply drops out. `isNew`: it
 * happened after I last looked. `key` is stable across loads.
 *   follow    `person` started following me
 *   bookmark  `person` (someone I follow) bookmarked `post`
 *   note      `person` (someone I follow) wrote a note on `post`; the whole thing is `bookmark`
 *   mention   `person` @mentioned me in the note on `bookmark`
 *   reply     `person` noted a post I saved; the note is on `bookmark`
 *   collection  `person` (someone I follow) made `collection`
 *   invite    someone signed up with my invite: `person`, or null when their profile is private
 * Only the kinds I've turned on in Settings (Me.notify*, Me.mentionsFrom).
 */
export type Notification =
  /** `following`: I already follow them back. */
  | { kind: 'follow'; key: string; at: string; isNew: boolean; person: NotificationPerson & { bio: string | null }; following: boolean }
  /** `bookmark`: the bookmark whole, note included, shown as a Bookmark card. */
  | { kind: 'bookmark' | 'note'; key: string; at: string; isNew: boolean; person: NotificationPerson; post: NotificationPost; bookmark: PublicBookmark }
  | { kind: 'mention'; key: string; at: string; isNew: boolean; person: NotificationPerson; bookmark: PublicBookmark }
  | { kind: 'reply'; key: string; at: string; isNew: boolean; person: NotificationPerson; bookmark: PublicBookmark }
  | { kind: 'collection'; key: string; at: string; isNew: boolean; person: NotificationPerson; collection: { name: string; slug: string; description: string | null; feedCount: number } }
  | { kind: 'invite'; key: string; at: string; isNew: boolean; person: (NotificationPerson & { bio: string | null }) | null; following: boolean };

export const notificationsApi = {
  /** The last 30 days, at most 100. Reading does not mark them seen; `asOf` is what to pass to `seen`. */
  list: () => j<{ items: Notification[]; count: number; more: boolean; seenAt: string; asOf: string }>('/api/notifications'),
  /** How many are new, for the bubble: up to 100, `more` past that. */
  count: () => j<{ count: number; more: boolean }>('/api/notifications/count'),
  /** I've looked, up to `upTo` (the list's `asOf`). */
  seen: (upTo: string) => j<{ seenAt: string }>('/api/notifications/seen', { method: 'POST', body: JSON.stringify({ upTo }) }),
};

export type BookmarkSources = {
  collections: { id: number; name: string; count: number }[];
  /** How many bookmarks I have in all, and how many of them carry a note. */
  total: number; noted: number;
};

export const itemsApi = {
  /** What the post is: readable by anyone, so a link you send works for whoever opens it. */
  get: (id: number) => j<ItemRef>(`/api/items/${id}`),
  /** The post's text, members only. */
  content: (id: number) => j<ItemContent>(`/api/items/${id}/content`)
};

export const bookmarksApi = {
  list: (opts: { before?: string | null; collection?: number | null; notes?: boolean; q?: string; limit?: number } = {}) => {
    const q = new URLSearchParams();
    if (opts.q) q.set('q', opts.q);
    if (opts.before) q.set('before', opts.before);
    if (opts.notes) q.set('notes', '1');
    if (opts.collection) q.set('collection', String(opts.collection));
    if (opts.limit) q.set('limit', String(opts.limit));
    return j<{ bookmarks: Bookmark[]; nextCursor: string | null }>(`/api/bookmarks?${q}`);
  },
  sources: () => j<BookmarkSources>('/api/bookmarks/sources'),
  /**
   * Where the download of every bookmark and note lives: one file, in the
   * format browsers and bookmark services read. It carries this device's
   * timezone so the times written in the file are the reader's own.
   */
  exportUrl: () => {
    let tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? ''; } catch { /* the file says UTC instead */ }
    return tz ? `/api/bookmarks/export?tz=${encodeURIComponent(tz)}` : '/api/bookmarks/export';
  },
  /** How many bookmarks I have, and the most one export holds. */
  exportInfo: () => j<{ count: number; limit: number }>('/api/bookmarks/export/info'),
  saveItem: (itemId: number) => j<BookmarkRow>('/api/bookmarks', { method: 'POST', body: JSON.stringify({ itemId }) }),
  /** Copy someone's public bookmark, snapshot and all (not their note), into my own set. */
  saveFrom: (bookmarkId: number) => j<BookmarkRow>('/api/bookmarks', { method: 'POST', body: JSON.stringify({ bookmarkId }) }),
  /** Removes the note on it too. Returns what was removed, for `restore`. */
  remove: (id: number) => j<BookmarkRow>(`/api/bookmarks/${id}`, { method: 'DELETE' }),
  /** Undo a removal: puts the bookmark back as it was, note, times and all. */
  restore: (row: BookmarkRow) => j<BookmarkRow>('/api/bookmarks', { method: 'POST', body: JSON.stringify({ restore: row }) }),
  /** Write the note on a bookmark directly, for one whose post is gone. */
  writeNote: (id: number, body: string) => j<SavedNote>(`/api/bookmarks/${id}/note`, { method: 'PUT', body: JSON.stringify({ body }) }),
  removeNote: (id: number) => j<void>(`/api/bookmarks/${id}/note`, { method: 'DELETE' })
};

export const iconUrl = (feedId: number) => `/api/feeds/${feedId}/icon`;

/** Canonical feed page URL: id is the identity, slug is for humans and search engines. */
export const feedHref = (f: { id: number; slug?: string | null }) => (f.slug ? `/feeds/${f.id}/${f.slug}` : `/feeds/${f.id}`);

/**
 * The readable tail of a post's address. Cosmetic and never stored: both ids in
 * the path are the identity, so a retitled post keeps its old links working and
 * the address bar simply corrects itself the next time it is opened.
 */
export function itemSlug(title: string | null | undefined): string {
  const s = (title ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!s) return '';
  if (s.length <= 60) return s;
  const cut = s.slice(0, 60);
  return cut.slice(0, Math.max(cut.lastIndexOf('-'), 20)).replace(/-$/, '');
}

/**
 * A post lives inside its feed: /feeds/:feedId/:feedSlug/:itemId/:itemSlug.
 * Everything after the feed id is for people to read; the ids do the resolving.
 */
export function itemHref(i: { id: number; feedId: number; feedSlug?: string | null; title?: string | null }): string {
  const slug = itemSlug(i.title);
  return `/feeds/${i.feedId}/${i.feedSlug || 'feed'}/${i.id}${slug ? `/${slug}` : ''}`;
}

// ---- accounts and profiles -------------------------------------------------

/** The signed-in user, including settings only they can see. */
/** Who a part of a profile is shared with. 'friends' is the people the owner follows. */
export type ShareLevel = 'private' | 'friends' | 'public';
export type Me = {
  id: number; handle: string; displayName: string | null; bio: string | null; homepageUrl: string | null;
  profileVisibility: 'public' | 'private';
  collectionsVisibility: ShareLevel; bookmarksVisibility: ShareLevel; notesVisibility: ShareLevel;
  /** Who may see the one running list of what I've been up to. Caps the whole list; each source still obeys its own section. */
  activityVisibility: ShareLevel;
  notesFrom: 'none' | 'following' | 'everyone';
  /** Which notifications I get (issue #274). Mentions have only `mentionsFrom`: "none" turns them off. */
  notifyFollows: boolean; notifyBookmarks: boolean; notifyNotes: boolean; notifyCollections: boolean; notifyInvites: boolean; notifyReplies: boolean;
  mentionsFrom: 'none' | 'following' | 'everyone';
  /** null = follow the instance setting (instanceTracking). */
  trackActivity: boolean | null; instanceTracking: boolean; hasPassword: boolean; createdAt: string; isAdmin: boolean;
  /** Feed setting defaults: leave Shorts out of YouTube channels unless a channel's own setting says otherwise. */
  hideShortsByDefault: boolean;
  /** When my profile picture was last set, or null for none. The UI hangs a ?v= off it so a change shows at once. */
  avatarUpdatedAt: string | null;
  /** When the setup tour was finished, skipped, or closed, or null if it hasn't been seen (issue #172). Shown once per account. */
  tourSeenAt: string | null;
  /** Display settings saved to offer a device that hasn't been set up, or null (issue #186). */
  savedDisplay: Display | null;
  /** The device keeping the saved settings up to date (its random id, see lib/saved-display), or null for none. */
  displaySource: string | null;
  /** When the account first had a device chosen for new devices to copy; null on an older account that hasn't opened a device since. */
  displayOfferAnsweredAt: string | null;
  /** A new account whose first setup hasn't been saved for new devices yet. */
  saveFirstDisplay: boolean;
  /**
   * readthicket.com only: where password-reset links go, and when it was confirmed
   * (null = waiting on the link). `pendingEmail` is a new address waiting on its
   * link while the confirmed one still gets resets.
   */
  email: string | null; emailConfirmedAt: string | null; pendingEmail: string | null;
};
export type SignupPolicy = 'open' | 'invite' | 'closed';
/**
 * `visitorLimit`: visitors without an account see only the newest items of anything a page lists.
 * `hosted`: this is readthicket.com, thicket's own service, not a self-hosted copy.
 */
export type InstanceStatus = { name: string; url: string; signups: SignupPolicy; visitorLimit: boolean; hosted: boolean };
export type Invite = { code: string; url: string; note: string | null; createdAt: string; expiresAt: string | null; usedAt: string | null; usedByHandle: string | null; createdByHandle: string };

/**
 * An API token: a credential for my own scripts and assistants. At most one
 * of each kind. `read` can only read; `full` can also change things.
 */
export type ApiTokenKind = 'read' | 'full';
export type ApiToken = { kind: ApiTokenKind; token: string; createdAt: string; lastUsedAt: string | null };

export const tokensApi = {
  list: () => j<{ tokens: ApiToken[] }>('/api/tokens'),
  enable: (kind: ApiTokenKind) => j<ApiToken>(`/api/tokens/${kind}`, { method: 'POST' }),
  revoke: (kind: ApiTokenKind) => j<void>(`/api/tokens/${kind}`, { method: 'DELETE' }),
};

export const authApi = {
  me: () => j<Me>('/api/auth/me'),
  status: () => j<InstanceStatus>('/api/auth/status'),
  signup: (handle: string, password: string, displayName?: string, inviteCode?: string, email?: string) => j<Me>('/api/auth/signup', { method: 'POST', body: JSON.stringify({ handle, password, displayName, inviteCode, email }) }),
  login: (handle: string, password: string) => j<Me>('/api/auth/login', { method: 'POST', body: JSON.stringify({ handle, password }) }),
  logout: () => j<void>('/api/auth/logout', { method: 'POST' }),
  update: (patch: Partial<Pick<Me, 'displayName' | 'bio' | 'homepageUrl' | 'profileVisibility' | 'collectionsVisibility' | 'bookmarksVisibility' | 'notesVisibility' | 'activityVisibility' | 'notesFrom' | 'trackActivity' | 'hideShortsByDefault' | 'notifyFollows' | 'notifyBookmarks' | 'notifyNotes' | 'notifyCollections' | 'notifyInvites' | 'notifyReplies' | 'mentionsFrom'>>) => j<Me>('/api/auth/me', { method: 'PATCH', body: JSON.stringify(patch) }),
  /**
   * Record that the setup tour was seen, so no device shows it again. Sent
   * while setup may be navigating away, so it outlives the page. A failure
   * only means another device may show the tour once more; it's logged for
   * support rather than shown.
   */
  tourSeen: () => {
    void fetch('/api/auth/me/tour', { method: 'POST', keepalive: true })
      .then((r) => { if (!r.ok) console.error(`Couldn't record that the setup tour was seen: ${r.status} ${r.statusText}`); })
      .catch((e) => console.error("Couldn't record that the setup tour was seen:", e));
  },
  /** Save these display settings to offer new devices, replacing any saved before. Refusals carry the reason. */
  /** `mode`: 'sync' saves only while this device keeps them, 'first' only if no device ever has; otherwise this device takes over. */
  saveDisplay: (settings: Display, device: string, mode?: 'sync' | 'first') => j<Me>('/api/auth/me/display', { method: 'PUT', body: JSON.stringify({ settings, device, mode }) }),
  /** Stop this device keeping the saved settings up to date. The saved settings stay. */
  stopDisplaySource: (device: string) => j<Me>('/api/auth/me/display-source', { method: 'DELETE', body: JSON.stringify({ device }) }),
  changePassword: (current: string, next: string) => j<void>('/api/auth/me/password', { method: 'POST', body: JSON.stringify({ current, next }) }),
  /** readthicket.com only, like the four below. `sent: false` means the address saved but the confirmation didn't go out; `error` says so. */
  setEmail: (email: string, password: string) => j<{ me: Me; sent: boolean; error?: string }>('/api/auth/me/email', { method: 'PUT', body: JSON.stringify({ email, password }) }),
  resendEmail: () => j<{ email: string }>('/api/auth/me/email/resend', { method: 'POST' }),
  confirmEmail: (token: string) => j<void>('/api/auth/confirm-email', { method: 'POST', body: JSON.stringify({ token }) }),
  /** Always succeeds the same way whether or not an account matched. */
  forgotPassword: (who: string) => j<void>('/api/auth/forgot-password', { method: 'POST', body: JSON.stringify({ who }) }),
  resetPassword: (token: string, password: string) => j<Me>('/api/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, password }) }),
  /** Upload a new profile picture. The blob is the already-cropped square; the server re-encodes it. */
  uploadAvatar: (blob: Blob) => { const fd = new FormData(); fd.append('avatar', blob, 'avatar.webp'); return j<{ hasAvatar: boolean; avatarUpdatedAt: string }>('/api/users/me/avatar', { method: 'POST', body: fd, headers: {} }); },
  removeAvatar: () => j<void>('/api/users/me/avatar', { method: 'DELETE' })
};

/** The address of a person's profile picture. `v` (their avatarUpdatedAt) busts the cache when they change it. */
export const avatarUrl = (handle: string, v?: string | null) => `/api/users/${encodeURIComponent(handle)}/avatar${v ? `?v=${encodeURIComponent(v)}` : ''}`;

export const ADMIN_FEED_SORTS = ['followers', 'posts', 'failures', 'lastPost', 'title'] as const;
export type AdminFeedSort = (typeof ADMIN_FEED_SORTS)[number];
/** One row of the admin feed list. */
export type AdminFeed = {
  id: number; url: string; siteUrl: string | null; title: string | null; slug: string; hasIcon: boolean;
  followerCount: number; posts30d: number; lastFetchedAt: string | null; lastItemAt: string | null; consecutiveFailures: number;
};
export type AdminFeedPage = { feeds: AdminFeed[]; total: number; page: number; per: number; sort: AdminFeedSort; dir: 'asc' | 'desc'; brokenAfter: number };
export type AdminFetch = { at: string; status: number | null; durationMs: number | null; itemsNew: number | null; error: string | null };
export type FeedMove =
  | { status: 'moved'; feedId: number; url: string; fetch: { status: number | null; itemsNew: number; error: string | null } }
  | { status: 'merged'; feedId: number }
  | { status: 'choose'; candidates: { url: string; title: string | null; kind: string | null; note?: string | null }[] };
export type AdminUser = {
  id: number; handle: string; displayName: string | null; isAdmin: boolean; profileVisibility: 'public' | 'private';
  createdAt: string; lastSeenAt: string | null; following: number; collections: number; bookmarks: number; invitedBy: string | null;
  avatarUpdatedAt: string | null;
};

/**
 * What a feed sent as categories, normalized: `declared` is what the feed says
 * about itself on its last fetch; `terms` are its posts' terms with how many
 * posts used each, most used first; `tagged` of `posts` came with any.
 */
export type FeedCategories = { declared: string[]; posts: number; tagged: number; terms: { term: string; posts: number }[] };

export const adminApi = {
  /** One page of accounts, newest first. Pass the previous page's `next` as `before` for the following page. */
  users: (opts: { q?: string; before?: string | null; limit?: number } = {}) => {
    const qs = new URLSearchParams();
    if (opts.q) qs.set('q', opts.q);
    if (opts.before) qs.set('before', opts.before);
    if (opts.limit !== undefined) qs.set('limit', String(opts.limit));
    const query = qs.toString();
    /** `total` and `matched` come with the first page only; they don't change while paging. */
    return j<{ users: AdminUser[]; next: string | null; total?: number; matched?: number }>(`/api/admin/users${query ? `?${query}` : ''}`);
  },
  setAdmin: (id: number, isAdmin: boolean) => j<{ id: number; handle: string; isAdmin: boolean }>(`/api/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify({ isAdmin }) }),
  resetPassword: (id: number) => j<{ handle: string; password: string }>(`/api/admin/users/${id}/password`, { method: 'POST' }),
  deleteUser: (id: number) => j<void>(`/api/admin/users/${id}`, { method: 'DELETE' }),
  /** Moderation: what removing this feed from the instance takes with it, then the removal itself. */
  feedImpact: (id: number) => j<{ title: string | null; url: string; posts: number; followers: number; collections: number; bookmarks: number }>(`/api/admin/feeds/${id}/impact`),
  deleteFeed: (id: number) => j<void>(`/api/admin/feeds/${id}`, { method: 'DELETE' }),
  /** The categories a feed ships (issue #189): what it declares about itself, and its posts' terms counted. Admins only, for now. */
  feedCategories: (id: number) => j<FeedCategories>(`/api/admin/feeds/${id}/categories`),
  /** The categories one post was filed under. Admins only, for now. */
  itemCategories: (id: number) => j<{ categories: string[] }>(`/api/admin/items/${id}/categories`),
  /** Retitle a feed for everyone; null hands the title back to the feed's own on its next check. */
  setFeedTitle: (id: number, title: string | null) => j<{ id: number; title: string | null }>(`/api/admin/feeds/${id}`, { method: 'PATCH', body: JSON.stringify({ title }) }),
  /** Every feed in the index, a page at a time, with its health (issue #103). */
  feeds: (opts: { q?: string; sort?: AdminFeedSort; dir?: 'asc' | 'desc'; page?: number; per?: number } = {}) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(opts)) if (v !== undefined && v !== '') q.set(k, String(v));
    return j<AdminFeedPage>(`/api/admin/feeds?${q}`);
  },
  /** One feed's checks over the last couple of weeks, newest first. */
  feedFetches: (id: number) => j<{ fetches: AdminFetch[]; windowDays: number }>(`/api/admin/feeds/${id}/fetches`),
  /** Point a feed at a new address, folding it into the feed already there if there is one. */
  moveFeed: (id: number, url: string) => j<FeedMove>(`/api/admin/feeds/${id}/address`, { method: 'POST', body: JSON.stringify({ url }) }),
  settings: () => j<InstanceStatus & { signupsStored: SignupPolicy | null; signupsDefault: SignupPolicy }>('/api/admin/settings'),
  update: (patch: { signups?: SignupPolicy; name?: string; visitorLimit?: boolean }) => j<InstanceStatus>('/api/admin/settings', { method: 'PATCH', body: JSON.stringify(patch) }),
  invites: () => j<{ invites: Invite[] }>('/api/admin/invites'),
  createInvite: (note?: string) => j<Invite>('/api/admin/invites', { method: 'POST', body: JSON.stringify({ note }) }),
  revokeInvite: (code: string) => j<void>(`/api/admin/invites/${encodeURIComponent(code)}`, { method: 'DELETE' }),
  /** Starter packs: whose public collections a newcomer is offered. */
  /** `choices`: with an account named, every collection of its that new people could be offered, for ticking. */
  starter: () => j<StarterSetting>('/api/admin/starter'),
  setStarter: (handle: string | null) => j<StarterSetting>('/api/admin/starter', { method: 'PUT', body: JSON.stringify({ handle: handle ?? '' }) }),
  /** Which of the account's collections are offered, by id. */
  setStarterPicks: (collectionIds: number[]) => j<StarterSetting>('/api/admin/starter', { method: 'PUT', body: JSON.stringify({ collectionIds }) })
};

export const feedbackApi = {
  /** Send feedback (issue #153, readthicket.com only). `page` is the path the person was on; their handle goes with it only if `includeHandle`. */
  send: (body: string, page: string, includeHandle: boolean) => j<{ ok: true }>('/api/feedback', { method: 'POST', body: JSON.stringify({ body, page, includeHandle }) })
};

export type PublicUser = { handle: string; displayName: string | null; bio: string | null; homepageUrl: string | null; createdAt: string; avatarUpdatedAt: string | null };
export type ProfileCollection = { id: number; parentId: number | null; name: string; slug: string; description: string | null; visibility: ShareLevel; feedCount: number; copiedFromId: number | null;
  /** The viewer has a copy of this one (never true on your own profile). */
  copiedByMe: boolean;
  /** A few of its feeds, for the icons at the front of its row. */
  sample: CollectionSample[] };
/** A few of a collection's feeds, drawn overlapped at the front of its row. */
export type CollectionSample = { id: number; title: string | null; hasIcon: boolean };
export type Profile =
  | { handle: string; private: true }
  | (PublicUser & {
      private: false; isMe: boolean; following: number;
      /** `followers` goes to the owner alone; null for everyone else. */
      people: { follows: number; followers: number | null; isFollowing: boolean };
      /** null = the owner hides collections from others. */
      collections: ProfileCollection[] | null;
      /**
       * Their saved posts and the notes on them: one section, two audiences.
       * `count`: posts I can see. `notes`: how many carry a note I can read
       * (null: notes aren't shared with me). `notedOnly`: bookmarks aren't
       * shared with me but notes are, so I see only the noted posts. null =
       * neither is shared with me.
       */
      bookmarks: { count: number; notes: number | null; notedOnly: boolean } | null;
      /** Whether I have any of their recent activity to see (always, for the owner). */
      activity: boolean;
      visibility?: { profile: 'public' | 'private'; collections: ShareLevel; bookmarks: ShareLevel; notes: ShareLevel; activity: ShareLevel };
    });
export type PublicCollectionFeed = {
  id: number; url: string; siteUrl: string | null; title: string | null; description: string | null; slug: string;
  lastItemAt: string | null; hasIcon: boolean; followerCount: number; myCollectionIds: number[]; sameTitle: number;
  /** The viewer's own name for this feed, if they gave it one. */
  displayName: string | null;
  /** Its recent checks failed. Only ever true for the collection's owner. */
  failing: boolean;
};
export type PublicCollection = {
  id: number; name: string; slug: string; description: string | null; visibility: ShareLevel; createdAt: string | null;
  owner: PublicUser; isMe: boolean; feeds: PublicCollectionFeed[]; children: { id: number; name: string; slug: string; description: string | null; feedCount: number; sample: CollectionSample[] }[];
  /**
   * For a signed-in visitor: the copy they already made of this collection, if
   * any, and how many of this collection's feeds it has. A copy with all of
   * them gets "Open your copy"; one with fewer is pointed out but not treated
   * as the same thing.
   */
  myCopy: { slug: string; name: string; sharedFeeds: number } | null;
  /** For the owner: the collection this one was copied from, while they can still see it. */
  copiedFrom: { name: string; slug: string; owner: PublicUser } | null;
};
/** Someone's saved post on their profile: their note, if they share notes with me, and whether I have saved it too. */
export type PublicBookmark = Omit<Bookmark, 'notes'> & { myBookmarkId: number | null };

export const profilesApi = {
  get: (handle: string) => j<Profile>(`/api/profiles/${encodeURIComponent(handle)}`),
  /** The people this person follows (public profiles only). */
  following: (handle: string) => j<{ owner: PublicUser; isMe: boolean; users: PublicUser[] }>(`/api/profiles/${encodeURIComponent(handle)}/following`),
  /** The people who follow me (public profiles only). Mine alone: any other handle is a 404. */
  followers: (handle: string) => j<{ users: PublicUser[] }>(`/api/profiles/${encodeURIComponent(handle)}/followers`),
  follow: (handle: string) => j<{ handle: string; isFollowing: boolean }>(`/api/profiles/${encodeURIComponent(handle)}/follow`, { method: 'POST' }),
  unfollow: (handle: string) => j<{ handle: string; isFollowing: boolean }>(`/api/profiles/${encodeURIComponent(handle)}/follow`, { method: 'DELETE' }),
  collection: (handle: string, slug: string) => j<PublicCollection>(`/api/profiles/${encodeURIComponent(handle)}/collections/${encodeURIComponent(slug)}`),
  copyCollection: (handle: string, slug: string) => j<Collection>(`/api/profiles/${encodeURIComponent(handle)}/collections/${encodeURIComponent(slug)}/copy`, { method: 'POST' }),
  opmlUrl: (handle: string, slug: string) => `/api/profiles/${encodeURIComponent(handle)}/collections/${encodeURIComponent(slug)}/opml`,
  /**
   * Their bookmarks, newest activity first. `notes`: only the ones with a note
   * (honored only when I may read their notes). `showsNotes`: whether I may.
   * `notedOnly`: they share notes but not bookmarks, so only noted posts come.
   */
  bookmarks: (handle: string, opts: { before?: string | null; limit?: number; notes?: boolean } = {}) => {
    const q = new URLSearchParams();
    if (opts.before) q.set('before', opts.before);
    if (opts.limit) q.set('limit', String(opts.limit));
    if (opts.notes) q.set('notes', '1');
    return j<{ owner: PublicUser; isMe: boolean; notedOnly: boolean; showsNotes: boolean; bookmarks: PublicBookmark[]; nextCursor: string | null; cappedAt?: number | null }>(`/api/profiles/${encodeURIComponent(handle)}/bookmarks?${q}`);
  },
  activity: (handle: string, before?: string | null, limit?: number) => {
    const q = new URLSearchParams();
    if (before) q.set('before', before);
    if (limit) q.set('limit', String(limit));
    return j<{ owner: PublicUser; isMe: boolean; entries: ActivityEntry[]; nextCursor: string | null; cappedAt?: number | null }>(`/api/profiles/${encodeURIComponent(handle)}/activity?${q}`);
  }
};

/**
 * One thing a person did, newest first. A run of feed adds to one collection
 * (an import, a copy) arrives as a single 'feeds' entry with a count, not one
 * entry per feed.
 */
export type ActivityEntry =
  | { kind: 'feeds'; at: string; id: number; payload: { collection: { name: string; slug: string; visibility: ShareLevel }; count: number; feeds: { id: number; title: string; hasIcon: boolean }[] } }
  | { kind: 'collection'; at: string; id: number; payload: { name: string; slug: string; visibility: ShareLevel; copiedFrom: { handle: string; name: string; slug: string } | null } }
  | { kind: 'bookmark'; at: string; id: number; payload: { url: string; title: string | null; siteTitle: string | null; feedId: number | null; hasIcon: boolean } }
  | { kind: 'note'; at: string; id: number; payload: { body: string; itemId: number; url: string; title: string | null; siteTitle: string | null; feedId: number; hasIcon: boolean } };

export type StarterSetting = { handle: string | null; from: string | null; offered: ExploreCollection[]; choices: ExploreCollection[] };
export type ExploreCollection = {
  id: number; name: string; slug: string; description: string | null; handle: string; displayName: string | null; feedCount: number;
  sample: CollectionSample[];
};
export type ExploreUser = {
  handle: string; displayName: string | null; bio: string | null; createdAt: string;
  feeds: number; collections: number; notes: number | null; isFollowing: boolean; avatarUpdatedAt: string | null;
};
export const exploreApi = {
  /**
   * Public collections by other people. No options = the homepage's handful.
   * `since` and `sort` are Explore's filters: a window on when the collection was made, and `feeds` (default), `newest` or `name`.
   */
  collections: (opts: { q?: string; network?: boolean; since?: string | null; sort?: string | null; limit?: number; offset?: number } | number = {}) => {
    const o = typeof opts === 'number' ? { limit: opts } : opts;
    const q = new URLSearchParams();
    if (o.q) q.set('q', o.q);
    if (o.network) q.set('network', '1');
    if (o.since) q.set('since', o.since);
    if (o.sort) q.set('sort', o.sort);
    if (o.limit) q.set('limit', String(o.limit));
    if (o.offset) q.set('offset', String(o.offset));
    return j<{ collections: ExploreCollection[]; total: number; nextOffset: number | null }>(`/api/explore/collections?${q}`);
  },
  /** `network`: only people I follow. `since`: a window on when they joined. `sort`: `name` (default: people I follow first, then A to Z) or `newest`. */
  users: (opts: { q?: string; network?: boolean; since?: string | null; sort?: string | null; limit?: number; offset?: number } = {}) => {
    const q = new URLSearchParams();
    if (opts.q) q.set('q', opts.q);
    if (opts.network) q.set('network', '1');
    if (opts.since) q.set('since', opts.since);
    if (opts.sort) q.set('sort', opts.sort);
    if (opts.limit) q.set('limit', String(opts.limit));
    if (opts.offset) q.set('offset', String(opts.offset));
    return j<{ users: ExploreUser[]; total: number; nextOffset: number | null }>(`/api/explore/users?${q}`);
  },
  /** The instance's starter packs: one account's public collections. `from` is that handle, or null when falling back. */
  featured: () => j<{ from: string | null; collections: (ExploreCollection & { isMine: boolean })[] }>('/api/explore/featured')
};

// ---- search ----------------------------------------------------------------

/**
 * One query, over one kind of thing at a time: the tab you are on. Feeds and
 * collections are aggregations over the posts that matched, so every row
 * carries its own evidence — `matches`, `posts`, `lastMatchAt` — and the UI
 * says it in words instead of showing a rank. `nameMatch` marks a row found by
 * its name rather than by its posts.
 */
export type SearchScope = 'posts' | 'feeds' | 'collections' | 'people';
export const SEARCH_SCOPES: SearchScope[] = ['posts', 'feeds', 'collections', 'people'];
/** Posts, when nothing says otherwise. `all` is the retired everything-at-once scope; old links land on posts. */
export const DEFAULT_SCOPE: SearchScope = 'posts';
export const scopeFrom = (v: string | null | undefined): SearchScope =>
  SEARCH_SCOPES.includes(v as SearchScope) ? (v as SearchScope) : DEFAULT_SCOPE;
export type SearchFeed = {
  id: number; url: string; siteUrl: string | null; title: string | null; description: string | null; slug: string;
  lastItemAt: string | null; consecutiveFailures: number; postsLast30d: number; hasIcon: boolean; myCollectionIds: number[];
  matches: number; posts: number; lastMatchAt: string | null; nameMatch: boolean;
  /** Posts in the last 30 days that match the search; same window as postsLast30d. */
  matchesLast30d: number;
  displayName: string | null;
};
export type SearchCollection = ExploreCollection & {
  isMine: boolean; copiedByMe: boolean; matches: number; matchingFeeds: number; lastMatchAt: string | null; nameMatch: boolean;
};
/** A post a search found: the same post an article card shows in a feed, plus where the search matched. */
export type SearchPost = RiverItem & {
  /** The part of the post that matched (with nothing typed, the start of its summary). Matched words are fenced (see lib/words.ts) so the page highlights them without rendering feed HTML. */
  snippet: string | null;
  /** The title with the matched words fenced the same way; null with nothing typed. */
  titleMarked: string | null;
  myCollectionIds: number[];
};
export type SearchPerson = {
  handle: string; displayName: string | null; bio: string | null;
  nameMatch: boolean; notesMatch: number; marksMatch: number;
  feeds: number; collections: number; isFollowing: boolean; avatarUpdatedAt: string | null;
  /** The one searching: shown, but with no Follow button. */
  isMe: boolean;
};
/**
 * `total` is null for the newest posts with nothing typed: the API doesn't count every post to print one number.
 * `capped`: a Posts search's count reached the API's cap, so there are more matches than `total` says.
 */
export type SearchGroup<T> = { rows: T[]; total: number | null; nextOffset: number | null; capped?: boolean };
type SearchRows = { feeds: SearchFeed; collections: SearchCollection; posts: SearchPost; people: SearchPerson };
/** The one list asked for, under its scope's name: `{ q, scope: 'posts', posts: { rows, total, nextOffset } }`. */
export type SearchResults<S extends SearchScope = SearchScope> = {
  q: string; scope: S;
  /** The order the list came back in. */
  sort: string | null;
} & { [K in S]: SearchGroup<SearchRows[K]> };

export const searchApi = {
  /**
   * `signal` cancels the request, and the API then cancels its query in the
   * database, so a search nobody is waiting for stops costing anything.
   */
  run: <S extends SearchScope>(opts: { q: string; scope: S; limit?: number; offset?: number; network?: string | null; since?: string | null; sort?: string | null }, signal?: AbortSignal) => {
    const p = new URLSearchParams({ q: opts.q, scope: opts.scope });
    if (opts.limit) p.set('limit', String(opts.limit));
    if (opts.offset) p.set('offset', String(opts.offset));
    if (opts.network) p.set('network', opts.network);
    if (opts.since) p.set('since', opts.since);
    if (opts.sort) p.set('sort', opts.sort);
    return j<SearchResults<S>>(`/api/search?${p}`, { signal });
  }
};

export const profileHref = (handle: string) => `/@${handle}`;
/** THE collection page: /@handle/collections/slug. Owner or visitor, the address is the same, so any copied URL is shareable. */
export const collectionHref = (handle: string, slug: string) => `/@${handle}/collections/${slug}`;
export const publicCollectionHref = collectionHref;
export const manageCollectionHref = (handle: string, slug: string) => `${collectionHref(handle, slug)}/manage`;
