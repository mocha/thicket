/** The only file that knows the API's shape. UI components import from here. */
/** My note on a post. One per post; edits keep createdAt and move updatedAt. */
export type Note = { id: number; body: string; createdAt: string; updatedAt: string };
export type PublicNote = Note & { author: { handle: string; displayName: string | null } };
export type RiverItem = {
  id: number; feedId: number; feedTitle: string | null; siteUrl: string | null;
  url: string | null; title: string | null; author: string | null; summary: string | null;
  imageUrl: string | null; publishedAt: string; hasIcon: boolean; bookmarkId: number | null;
  myNote: Note | null;
  /** Other people's notes the viewer is allowed to see, newest first. */
  notes: PublicNote[];
};
export type RiverPage = { items: RiverItem[]; nextCursor: string | null; hidden: number };

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
};
export type FeedIndexPage = { feeds: Feed[]; total: number; indexTotal: number; nextOffset: number | null };

export type Collection = { id: number; parentId: number | null; name: string; slug: string; description: string | null; feedCount: number; isPublic: boolean };

export type SubscribeOutcome =
  | { status: 'subscribed'; feed: Feed; alreadyFollowed: boolean }
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

async function j<T>(input: string, init?: RequestInit): Promise<T> {
  let res = await fetch(input, { headers: { 'content-type': 'application/json' }, ...init });
  // thicket itself never answers 429 through this path (the one 429, refresh cooldown, uses raw fetch),
  // so a 429 here means a proxy in front dropped the request before the server saw it. That makes it
  // safe to retry any method. Back off 0.5s, 1s, 2s, 4s with jitter, honouring Retry-After if present.
  for (let attempt = 0; res.status === 429 && attempt < 4; attempt++) {
    const hinted = Number(res.headers.get('retry-after') ?? 0) * 1000;
    await sleep(Math.min(6000, hinted || 500 * 2 ** attempt) + Math.random() * 300);
    res = await fetch(input, { headers: { 'content-type': 'application/json' }, ...init });
  }
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) onUnauthorized?.();
  if (!res.ok && !('status' in body)) throw new ApiError(body.error ?? `HTTP ${res.status}`, res.status, body.field);
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
  /** What you follow and what arrived today, for the top of All my feeds. */
  riverStats: () => j<{ feeds: number; collections: number; posts24h: number; feeds24h: number }>('/api/river/stats'),
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
  follow: (id: number, collectionId?: number) => j<{ feedId: number; collectionIds: number[] }>(`/api/feeds/${id}/follow`, { method: 'POST', body: JSON.stringify({ collectionId }) }),
  addFeed: (url: string, collectionIds: number[] = []) => j<SubscribeOutcome>('/api/feeds', { method: 'POST', body: JSON.stringify({ url, collectionIds }) }),
  unfollow: (id: number) => j<{ feedId: number; collectionIds: number[] }>(`/api/feeds/${id}`, { method: 'DELETE' }),
  restore: (id: number, collectionIds: number[]) => j<{ feedId: number; collectionIds: number[] }>(`/api/feeds/${id}/restore`, { method: 'POST', body: JSON.stringify({ collectionIds }) }),
  /** Refresh is rate-limited per feed; a 429 comes back as { cooldown: seconds } instead of throwing. */
  refresh: async (id: number): Promise<{ ok: true } | { ok: false; cooldown: number }> => {
    const res = await fetch(`/api/feeds/${id}/refresh`, { method: 'POST' });
    if (res.status === 429) { const b = await res.json().catch(() => ({})); return { ok: false, cooldown: Number(b.retryAfterS ?? 300) }; }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { ok: true };
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
};
export type CollectionDetail = Collection & { userId: number; feeds: CollectionFeed[]; children: Collection[] };
export type ImportResult = { feeds: number; collections: number; skipped: string[] };

export const collectionsApi = {
  get: (id: number) => j<CollectionDetail>(`/api/collections/${id}`),
  /** Feeds that would stop being followed if this collection were deleted. */
  orphans: (id: number) => j<{ feeds: { id: number; title: string | null; url: string; siteUrl: string | null; slug: string; hasIcon: boolean }[] }>(`/api/collections/${id}/orphans`),
  create: (name: string, parentId?: number) => j<Collection>('/api/collections', { method: 'POST', body: JSON.stringify({ name, parentId }) }),
  update: (id: number, patch: { name?: string; description?: string; parentId?: number; isPublic?: boolean }) => j<Collection>(`/api/collections/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  remove: (id: number) => j<{ deleted: number }>(`/api/collections/${id}`, { method: 'DELETE' }),
  removeFeed: (id: number, feedId: number) => j<unknown>(`/api/collections/${id}/feeds/${feedId}`, { method: 'DELETE' }),
  addFeed: (id: number, feedId: number) => j<unknown>(`/api/collections/${id}/feeds/${feedId}`, { method: 'PUT' }),
  setFeedCollections: (feedId: number, collectionIds: number[]) => j<{ feedId: number; collectionIds: number[] }>(`/api/feeds/${feedId}/collections`, { method: 'PUT', body: JSON.stringify({ collectionIds }) }),
  opmlUrl: (id: number) => `/api/collections/${id}/opml`,
  /** Copy a collection from anywhere: a thicket collection page on any instance, or an OPML URL. */
  importUrl: (url: string) => j<ImportResult & { collection: Collection }>('/api/collections/import-url', { method: 'POST', body: JSON.stringify({ url }) }),
  importOpml: async (id: number, file: File): Promise<ImportResult> => {
    const res = await fetch(`/api/collections/${id}/import`, { method: 'POST', headers: { 'content-type': 'text/x-opml' }, body: await file.text() });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
    return body as ImportResult;
  }
};

export type Bookmark = {
  id: number; itemId: number | null; feedId: number | null; url: string; title: string | null; summary: string | null;
  imageUrl: string | null; siteTitle: string | null; author: string | null; publishedAt: string | null; note: string | null;
  savedAt: string; hasIcon: boolean;
};
export const NOTE_MAX = 2000;
export type NotesPage = { items: RiverItem[]; nextCursor: string | null };
export const notesApi = {
  list: (opts: { before?: string | null; limit?: number } = {}) => {
    const q = new URLSearchParams();
    if (opts.before) q.set('before', opts.before);
    if (opts.limit) q.set('limit', String(opts.limit));
    return j<NotesPage>(`/api/notes?${q}`);
  },
  count: () => j<{ count: number }>('/api/notes/count'),
  write: (itemId: number, body: string) => j<Note>(`/api/notes/items/${itemId}`, { method: 'PUT', body: JSON.stringify({ body }) }),
  remove: (itemId: number) => j<void>(`/api/notes/items/${itemId}`, { method: 'DELETE' }),
};

export type BookmarkSources = { feeds: { feedId: number; title: string | null; count: number }[]; collections: { id: number; name: string; count: number }[] };

export const bookmarksApi = {
  list: (opts: { before?: string | null; feed?: number | null; collection?: number | null; limit?: number } = {}) => {
    const q = new URLSearchParams();
    if (opts.before) q.set('before', opts.before);
    if (opts.feed) q.set('feed', String(opts.feed));
    if (opts.collection) q.set('collection', String(opts.collection));
    if (opts.limit) q.set('limit', String(opts.limit));
    return j<{ bookmarks: Bookmark[]; nextCursor: string | null }>(`/api/bookmarks?${q}`);
  },
  sources: () => j<BookmarkSources>('/api/bookmarks/sources'),
  saveItem: (itemId: number) => j<Bookmark>('/api/bookmarks', { method: 'POST', body: JSON.stringify({ itemId }) }),
  saveUrl: (url: string, title?: string) => j<Bookmark>('/api/bookmarks', { method: 'POST', body: JSON.stringify({ url, title }) }),
  /** Copy someone's public bookmark, snapshot and all, into my own set. */
  saveFrom: (bookmarkId: number) => j<Bookmark>('/api/bookmarks', { method: 'POST', body: JSON.stringify({ bookmarkId }) }),
  remove: (id: number) => j<Bookmark>(`/api/bookmarks/${id}`, { method: 'DELETE' })
};

export const iconUrl = (feedId: number) => `/api/feeds/${feedId}/icon`;

/** Canonical feed page URL: id is the identity, slug is for humans and search engines. */
export const feedHref = (f: { id: number; slug?: string | null }) => (f.slug ? `/feeds/${f.id}/${f.slug}` : `/feeds/${f.id}`);

// ---- accounts and profiles -------------------------------------------------

/** The signed-in user, including settings only they can see. */
/** Who a part of a profile is shared with. 'friends' is the people the owner follows. */
export type ShareLevel = 'private' | 'friends' | 'public';
export type Me = {
  id: number; handle: string; displayName: string | null; bio: string | null; homepageUrl: string | null;
  profileVisibility: 'public' | 'private';
  collectionsVisibility: ShareLevel; bookmarksVisibility: ShareLevel; notesVisibility: ShareLevel;
  notesFrom: 'none' | 'following' | 'everyone';
  /** null = follow the instance setting (instanceTracking). */
  trackActivity: boolean | null; instanceTracking: boolean; hasPassword: boolean; createdAt: string; isAdmin: boolean;
};
export type SignupPolicy = 'open' | 'invite' | 'closed';
export type InstanceStatus = { name: string; url: string; signups: SignupPolicy };
export type Invite = { code: string; url: string; note: string | null; createdAt: string; expiresAt: string | null; usedAt: string | null; usedByHandle: string | null; createdByHandle: string };

export const authApi = {
  me: () => j<Me>('/api/auth/me'),
  status: () => j<InstanceStatus>('/api/auth/status'),
  signup: (handle: string, password: string, displayName?: string, inviteCode?: string) => j<Me>('/api/auth/signup', { method: 'POST', body: JSON.stringify({ handle, password, displayName, inviteCode }) }),
  login: (handle: string, password: string) => j<Me>('/api/auth/login', { method: 'POST', body: JSON.stringify({ handle, password }) }),
  logout: () => j<void>('/api/auth/logout', { method: 'POST' }),
  update: (patch: Partial<Pick<Me, 'displayName' | 'bio' | 'homepageUrl' | 'profileVisibility' | 'collectionsVisibility' | 'bookmarksVisibility' | 'notesVisibility' | 'notesFrom' | 'trackActivity'>>) => j<Me>('/api/auth/me', { method: 'PATCH', body: JSON.stringify(patch) }),
  changePassword: (current: string, next: string) => j<void>('/api/auth/me/password', { method: 'POST', body: JSON.stringify({ current, next }) })
};

export type AdminUser = {
  id: number; handle: string; displayName: string | null; isAdmin: boolean; profileVisibility: 'public' | 'private';
  createdAt: string; lastSeenAt: string | null; following: number; collections: number; bookmarks: number; invitedBy: string | null;
};

export const adminApi = {
  users: () => j<{ users: AdminUser[] }>('/api/admin/users'),
  setAdmin: (id: number, isAdmin: boolean) => j<{ id: number; handle: string; isAdmin: boolean }>(`/api/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify({ isAdmin }) }),
  resetPassword: (id: number) => j<{ handle: string; password: string }>(`/api/admin/users/${id}/password`, { method: 'POST' }),
  deleteUser: (id: number) => j<void>(`/api/admin/users/${id}`, { method: 'DELETE' }),
  settings: () => j<InstanceStatus & { signupsStored: SignupPolicy | null; signupsDefault: SignupPolicy }>('/api/admin/settings'),
  update: (patch: { signups?: SignupPolicy; name?: string }) => j<InstanceStatus>('/api/admin/settings', { method: 'PATCH', body: JSON.stringify(patch) }),
  invites: () => j<{ invites: Invite[] }>('/api/admin/invites'),
  createInvite: (note?: string) => j<Invite>('/api/admin/invites', { method: 'POST', body: JSON.stringify({ note }) }),
  revokeInvite: (code: string) => j<void>(`/api/admin/invites/${encodeURIComponent(code)}`, { method: 'DELETE' }),
  /** Starter packs: whose public collections a newcomer is offered. */
  starter: () => j<{ handle: string | null; candidates: StarterCandidate[] }>('/api/admin/starter'),
  setStarter: (handle: string | null) => j<{ handle: string | null }>('/api/admin/starter', { method: 'PUT', body: JSON.stringify({ handle: handle ?? '' }) })
};
export type StarterCandidate = { handle: string; displayName: string | null; collectionCount: number; feedCount: number };

export type PublicUser = { handle: string; displayName: string | null; bio: string | null; homepageUrl: string | null; createdAt: string };
export type ProfileCollection = { id: number; name: string; slug: string; description: string | null; isPublic: boolean; feedCount: number; copiedFromId: number | null };
export type Profile =
  | { handle: string; private: true }
  | (PublicUser & {
      private: false; isMe: boolean; following: number;
      people: { follows: number; followers: number; isFollowing: boolean };
      notes: { count: number } | null;
      /** null = the owner hides collections from others. */
      collections: ProfileCollection[] | null;
      bookmarks: { count: number } | null;
      visibility?: { profile: 'public' | 'private'; collections: ShareLevel; bookmarks: ShareLevel; notes: ShareLevel };
    });
export type PublicCollectionFeed = {
  id: number; url: string; siteUrl: string | null; title: string | null; description: string | null; slug: string;
  lastItemAt: string | null; hasIcon: boolean; followerCount: number; myCollectionIds: number[]; sameTitle: number;
};
export type PublicCollection = {
  id: number; name: string; slug: string; description: string | null; isPublic: boolean; createdAt: string | null;
  owner: PublicUser; isMe: boolean; feeds: PublicCollectionFeed[]; children: { id: number; name: string; slug: string; description: string | null; feedCount: number }[];
};
export type PublicBookmark = Omit<Bookmark, 'note'> & { myBookmarkId: number | null };

export const profilesApi = {
  get: (handle: string) => j<Profile>(`/api/profiles/${encodeURIComponent(handle)}`),
  follow: (handle: string) => j<{ handle: string; isFollowing: boolean }>(`/api/profiles/${encodeURIComponent(handle)}/follow`, { method: 'POST' }),
  unfollow: (handle: string) => j<{ handle: string; isFollowing: boolean }>(`/api/profiles/${encodeURIComponent(handle)}/follow`, { method: 'DELETE' }),
  collection: (handle: string, slug: string) => j<PublicCollection>(`/api/profiles/${encodeURIComponent(handle)}/collections/${encodeURIComponent(slug)}`),
  copyCollection: (handle: string, slug: string) => j<Collection>(`/api/profiles/${encodeURIComponent(handle)}/collections/${encodeURIComponent(slug)}/copy`, { method: 'POST' }),
  opmlUrl: (handle: string, slug: string) => `/api/profiles/${encodeURIComponent(handle)}/collections/${encodeURIComponent(slug)}/opml`,
  bookmarks: (handle: string, before?: string | null) => j<{ owner: PublicUser; isMe: boolean; bookmarks: PublicBookmark[]; nextCursor: string | null }>(`/api/profiles/${encodeURIComponent(handle)}/bookmarks${before ? `?before=${encodeURIComponent(before)}` : ''}`),
  activity: (handle: string, before?: string | null) => j<{ owner: PublicUser; isMe: boolean; entries: ActivityEntry[]; nextCursor: string | null }>(`/api/profiles/${encodeURIComponent(handle)}/activity${before ? `?before=${encodeURIComponent(before)}` : ''}`)
};

/**
 * One thing a person did, newest first. A run of feed adds to one collection
 * (an import, a copy) arrives as a single 'feeds' entry with a count, not one
 * entry per feed.
 */
export type ActivityEntry =
  | { kind: 'feeds'; at: string; id: number; payload: { collection: { name: string; slug: string; isPublic: boolean }; count: number; feeds: { id: number; title: string; hasIcon: boolean }[] } }
  | { kind: 'collection'; at: string; id: number; payload: { name: string; slug: string; isPublic: boolean; copiedFrom: { handle: string; name: string; slug: string } | null } }
  | { kind: 'bookmark'; at: string; id: number; payload: { url: string; title: string | null; siteTitle: string | null; feedId: number | null; hasIcon: boolean } }
  | { kind: 'note'; at: string; id: number; payload: { body: string; itemId: number; url: string; title: string | null; siteTitle: string | null; feedId: number; hasIcon: boolean } };

export type ExploreCollection = {
  id: number; name: string; slug: string; description: string | null; handle: string; displayName: string | null; feedCount: number;
  sample: { id: number; title: string | null; hasIcon: boolean }[];
};
export type ExploreUser = {
  handle: string; displayName: string | null; bio: string | null; createdAt: string;
  feeds: number; collections: number; notes: number | null; isFollowing: boolean;
};
export const exploreApi = {
  /** Public collections by other people. No options = the homepage's handful. */
  collections: (opts: { q?: string; network?: boolean; limit?: number; offset?: number } | number = {}) => {
    const o = typeof opts === 'number' ? { limit: opts } : opts;
    const q = new URLSearchParams();
    if (o.q) q.set('q', o.q);
    if (o.network) q.set('network', '1');
    if (o.limit) q.set('limit', String(o.limit));
    if (o.offset) q.set('offset', String(o.offset));
    return j<{ collections: ExploreCollection[]; total: number; indexTotal: number; nextOffset: number | null }>(`/api/explore/collections?${q}`);
  },
  users: (opts: { q?: string; limit?: number; offset?: number } = {}) => {
    const q = new URLSearchParams();
    if (opts.q) q.set('q', opts.q);
    if (opts.limit) q.set('limit', String(opts.limit));
    if (opts.offset) q.set('offset', String(opts.offset));
    return j<{ users: ExploreUser[]; total: number; indexTotal: number; nextOffset: number | null }>(`/api/explore/users?${q}`);
  },
  /** The instance's starter packs: one account's public collections. `from` is that handle, or null when falling back. */
  featured: () => j<{ from: string | null; collections: (ExploreCollection & { isMine: boolean })[] }>('/api/explore/featured')
};

export const profileHref = (handle: string) => `/@${handle}`;
/** THE collection page: /@handle/collections/slug. Owner or visitor, the address is the same, so any copied URL is shareable. */
export const collectionHref = (handle: string, slug: string) => `/@${handle}/collections/${slug}`;
export const publicCollectionHref = collectionHref;
export const manageCollectionHref = (handle: string, slug: string) => `${collectionHref(handle, slug)}/manage`;
