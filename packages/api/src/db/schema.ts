/**
 * thicket data model.
 *
 * Shape decisions:
 * - Feeds are GLOBAL. One row per normalized URL, fetched once no matter how
 *   many users follow it. Items belong to the feed, not to a user.
 * - Users organize feeds through collections. A user "follows" a feed iff it
 *   appears in at least one of their collections. There is no separate
 *   subscriptions table; that would be a second source of truth.
 * - Collections are a tree (parent_id) from day one, even if the UI is flat.
 * - A collection is a list of feeds. Bookmarks are one private set per user,
 *   filterable by feed or collection at query time (see bookmarks below).
 * - Users have handles and layered visibility: profile, then section, then collection.
 * - Blocks are per-user and structural now, functional later.
 * - Events are product analytics, gated by TRACK_ACTIVITY, prunable.
 * - No read/unread state. The river is chronological; users scroll.
 */
import {
  pgTable, bigserial, bigint, text, timestamp, integer, boolean, jsonb,
  primaryKey, uniqueIndex, index, pgEnum, customType,
} from "drizzle-orm/pg-core";

export const feedKind = pgEnum("feed_kind", ["rss", "atom", "json", "rdf", "unknown"]);

export const profileVisibility = pgEnum("profile_visibility", ["public", "private"]);
/** Whose notes a reader wants to see on posts: nobody's, the people they follow, or everyone who shares. */
export const notesFrom = pgEnum("notes_from", ["none", "following", "everyone"]);
/**
 * Who I share a part of my profile with. "friends" means **the people I
 * follow** — following someone is how you choose to share with them, and
 * someone following me gains nothing by it. A feed document can only ever
 * carry 'public'; see docs/DECISIONS.md in the notes repo.
 */
export const shareLevel = pgEnum("share_level", ["private", "friends", "public"]);

/**
 * A person on this instance. Handle + password, no email: identity here is the
 * handle, and the instance is small enough that recovery is "ask the admin".
 * Everything on the profile is optional. Visibility is layered: the profile as
 * a whole, then notes / bookmarks / collections as sections with their own
 * audience, then each collection (collections.visibility), which can only ever
 * narrow its section. A private profile still counts toward follower numbers;
 * it is opaque, not absent.
 */
export const users = pgTable("users", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  /** Lowercase, 2-30 chars of [a-z0-9_-]. The URL is /@handle. */
  handle: text("handle").notNull().unique(),
  /** scrypt, stored as "scrypt$<salt hex>$<hash hex>". Null = cannot log in. */
  passwordHash: text("password_hash"),
  displayName: text("display_name"),
  bio: text("bio"),
  homepageUrl: text("homepage_url"),
  profileVisibility: profileVisibility("profile_visibility").notNull().default("public"),
  collectionsVisibility: shareLevel("collections_visibility").notNull().default("public"),
  bookmarksVisibility: shareLevel("bookmarks_visibility").notNull().default("public"),
  /** Who may see the notes I leave on posts. A reader still has to want them (notes_from). */
  notesVisibility: shareLevel("notes_visibility").notNull().default("public"),
  /**
   * Who may see my recent activity as one list. This caps the whole list; each
   * source inside it still obeys its own section audience, so nobody sees an
   * entry here they couldn't see in the section it came from.
   */
  activityVisibility: shareLevel("activity_visibility").notNull().default("public"),
  /** Whose notes appear on posts in my rivers. Default: people I follow. */
  notesFrom: notesFrom("notes_from").notNull().default("following"),
  /** Future: a "writes at" link to a feed in the index, verified via rel="me" on the site. Unverified claims are never shown. */
  claimedFeedId: bigint("claimed_feed_id", { mode: "number" }),
  claimVerifiedAt: timestamp("claim_verified_at", { withTimezone: true }),
  // Per-user override of instance-level activity tracking. null = inherit.
  trackActivity: boolean("track_activity"),
  /** "Feed setting defaults": leave Shorts out of every YouTube channel unless that feed's own setting says otherwise. */
  hideShortsByDefault: boolean("hide_shorts_by_default").notNull().default(false),
  /** The first account on an instance is the admin; admins can promote others later. */
  isAdmin: boolean("is_admin").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Instance-wide settings an admin can change at runtime, as one JSON row per
 * key. Environment variables seed defaults; this table wins once set.
 * Today: signups ("open" | "invite" | "closed"), name.
 */
export const instanceSettings = pgTable("instance_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Single-use invite codes, minted by admins, redeemed at sign-up. */
export const invites = pgTable("invites", {
  code: text("code").primaryKey(),
  createdBy: bigint("created_by", { mode: "number" }).notNull().references(() => users.id, { onDelete: "cascade" }),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  usedBy: bigint("used_by", { mode: "number" }).references(() => users.id, { onDelete: "set null" }),
  usedAt: timestamp("used_at", { withTimezone: true }),
});

/**
 * Opaque session tokens. The cookie holds the random token; we store its
 * sha256 so a database read never yields a usable credential. Sliding expiry.
 */
export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: bigint("user_id", { mode: "number" }).notNull().references(() => users.id, { onDelete: "cascade" }),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (t) => [index("sessions_user_idx").on(t.userId)]);

export const feeds = pgTable("feeds", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  /** Normalized feed URL. Uniqueness is on this. See feeds/normalize.ts. */
  url: text("url").notNull(),
  /** Where the site lives (from <link> in the feed or discovery page). */
  siteUrl: text("site_url"),
  title: text("title"),
  description: text("description"),
  kind: feedKind("kind").notNull().default("unknown"),
  /** Conditional-GET state. */
  etag: text("etag"),
  lastModified: text("last_modified"),
  /** Scheduling. */
  lastFetchedAt: timestamp("last_fetched_at", { withTimezone: true }),
  nextFetchAt: timestamp("next_fetch_at", { withTimezone: true }).notNull().defaultNow(),
  fetchIntervalS: integer("fetch_interval_s").notNull().default(3600),
  /** Health. */
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  lastStatus: integer("last_status"),
  lastError: text("last_error"),
  /** Most recent item published_at we've seen; drives adaptive interval. */
  lastItemAt: timestamp("last_item_at", { withTimezone: true }),
  /** When we last looked for a site icon (success or not). Rechecked monthly. */
  iconCheckedAt: timestamp("icon_checked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("feeds_url_uq").on(t.url),
  index("feeds_next_fetch_idx").on(t.nextFetchAt),
]);

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

/**
 * Cached site icons, one per feed, only for feeds whose icon passed the
 * quality bar (real image, >= 32px). Served from /api/feeds/:id/icon so the
 * browser never talks to the origin and dead icons never break the UI.
 * Feeds without a row here render a monogram.
 */
export const feedIcons = pgTable("feed_icons", {
  feedId: bigint("feed_id", { mode: "number" }).primaryKey().references(() => feeds.id, { onDelete: "cascade" }),
  sourceUrl: text("source_url").notNull(),
  contentType: text("content_type").notNull(),
  width: integer("width"),
  bytes: bytea("bytes").notNull(),
  /** sha256 of bytes. The same icon on 3+ distinct sites is a platform default (WordPress, Bearblog...). */
  hash: text("hash").notNull(),
  /** True when this icon is a platform default; the UI shows a monogram instead. */
  generic: boolean("generic").notNull().default(false),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("feed_icons_hash_idx").on(t.hash)]);

/**
 * A person's profile picture, one per user. Twin of feed_icons: the image
 * bytes live in Postgres, not on a disk or a bucket, so the one-volume backup
 * still captures everything. Served from /api/users/:handle/avatar. What lands
 * here is already cropped to a square and re-encoded to a small WebP on upload
 * (see routes/users.ts), so rows stay a few KB. Users without a row render a
 * monogram, exactly as feeds without an icon do.
 */
export const userAvatars = pgTable("user_avatars", {
  userId: bigint("user_id", { mode: "number" }).primaryKey().references(() => users.id, { onDelete: "cascade" }),
  contentType: text("content_type").notNull(),
  width: integer("width"),
  bytes: bytea("bytes").notNull(),
  /** sha256 of bytes, for the ETag and to skip rewriting an identical image. */
  hash: text("hash").notNull(),
  /** Bumped on every change; the UI hangs a ?v= off it so a new picture shows at once. */
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const items = pgTable("items", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  feedId: bigint("feed_id", { mode: "number" }).notNull().references(() => feeds.id, { onDelete: "cascade" }),
  /** Stable identity within a feed: guid → link → content hash. */
  dedupeKey: text("dedupe_key").notNull(),
  url: text("url"),
  title: text("title"),
  author: text("author"),
  /** Short text for the river card. Plain text, truncated. A display string. */
  summary: text("summary"),
  /**
   * The item's body as delivered by the feed, whole and unmodified: the rich
   * field where there is one (`content:encoded`, Atom `<content>`,
   * `content_html`), otherwise the description. Raw publisher HTML — it feeds
   * search (the tsvector strips tags) and is never rendered in-app in the
   * current reading model. Anything that does render it has to sanitize first.
   */
  content: text("content"),
  imageUrl: text("image_url"),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("items_feed_dedupe_uq").on(t.feedId, t.dedupeKey),
  index("items_published_idx").on(t.publishedAt),
  /** Covers the river's per-feed merge (routes/river.ts): feed_id to seek,
   *  published_at + id to order, and id in the index so the scan needs no heap. */
  index("items_feed_published_id_idx").on(t.feedId, t.publishedAt.desc(), t.id.desc()),
]);

/**
 * Posts that appear to repeat an earlier post from the same feed (feeds/repeats.ts).
 * Recorded, never hidden: the post says so and the feed's stats count them.
 * The match uses items_feed_titlekey_idx, an expression index on
 * (feed_id, lower(regexp_replace(title, '[^[:alnum:]]+', '', 'g'))), created in
 * drizzle/0011_item_repeats.sql.
 */
export const itemRepeats = pgTable("item_repeats", {
  itemId: bigint("item_id", { mode: "number" }).notNull().references(() => items.id, { onDelete: "cascade" }),
  ofItemId: bigint("of_item_id", { mode: "number" }).notNull().references(() => items.id, { onDelete: "cascade" }),
}, (t) => [
  primaryKey({ columns: [t.itemId, t.ofItemId] }),
  index("item_repeats_of_idx").on(t.ofItemId),
]);

export const collections = pgTable("collections", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: bigint("user_id", { mode: "number" }).notNull().references(() => users.id, { onDelete: "cascade" }),
  /** null = root. Exactly one root per user, created with the user. */
  parentId: bigint("parent_id", { mode: "number" }),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  description: text("description"),
  /**
   * The one individual override in thicket: a collection carries its own
   * audience on the same scale as the account (share_level). It only ever
   * narrows — a private collection inside a public account is private; a public
   * collection inside a friends-only account is still friends-only.
   */
  visibility: shareLevel("visibility").notNull().default("public"),
  /** Provenance when copied from another user's collection. Informational; the copy is independent. */
  copiedFromId: bigint("copied_from_id", { mode: "number" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  /** One address per collection: /@handle/collections/:slug resolves to exactly one row. */
  uniqueIndex("collections_user_slug_uq").on(t.userId, t.slug),
  index("collections_user_idx").on(t.userId),
]);

export const collectionFeeds = pgTable("collection_feeds", {
  collectionId: bigint("collection_id", { mode: "number" }).notNull().references(() => collections.id, { onDelete: "cascade" }),
  feedId: bigint("feed_id", { mode: "number" }).notNull().references(() => feeds.id, { onDelete: "cascade" }),
  /**
   * Never set by anything. A feed's name is now per person rather than per
   * collection (feed_settings.display_name, 2026-09-14). Still read by older
   * queries as coalesce(title_override, title), which is just the title.
   */
  titleOverride: text("title_override"),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.collectionId, t.feedId] }),
  index("collection_feeds_feed_idx").on(t.feedId),
]);

/**
 * A person's settings on one feed. Feeds are shared; this is the layer that is
 * yours: what you call it, and what of it reaches your rivers. Nothing here
 * changes the feed for anyone else, and a collection you share or someone
 * copies does not carry it.
 *
 * Per person, not per collection: the same feed in two of my collections is one
 * relationship with one source. And a feed is still the address fetched — a
 * setting never becomes a second feed (see feeds/youtube.ts, "Shorts").
 *
 * A row exists only while something differs from the default (the settings
 * endpoint deletes an all-default row), so rows per feed count the people who
 * changed something. That is the signal for, later, turning a choice most
 * people make into the default for everyone. Typed columns rather than a JSON
 * blob for the same reason: "how many hide Shorts on this channel" is a count.
 */
export const feedSettings = pgTable("feed_settings", {
  userId: bigint("user_id", { mode: "number" }).notNull().references(() => users.id, { onDelete: "cascade" }),
  feedId: bigint("feed_id", { mode: "number" }).notNull().references(() => feeds.id, { onDelete: "cascade" }),
  /** Shown instead of the feed's own title wherever this person reads it. */
  displayName: text("display_name"),
  /**
   * YouTube only: leave Shorts out of this person's rivers. Three-way: true
   * hides them on this channel, false shows them whatever the default, and
   * null follows the person's default (users.hide_shorts_by_default).
   */
  hideShorts: boolean("hide_shorts"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.userId, t.feedId] }),
  index("feed_settings_feed_idx").on(t.feedId),
]);

/**
 * Sites that told thicket to back off, and until when (feeds/hosts.ts). Kept in
 * the database only so a restart in the middle of a pause does not forget it
 * and ask again straight away. `host` is the registrable domain (reddit.com).
 * A row is removed when a feed on that host next fetches successfully.
 */
export const hostCooldowns = pgTable("host_cooldowns", {
  host: text("host").primaryKey(),
  until: timestamp("until", { withTimezone: true }).notNull(),
  reason: text("reason"),
  /** 429s in a row, for the doubling default pause when a site gives no Retry-After. */
  strikes: integer("strikes").notNull().default(0),
  /** Host-wide outages in a row, for the doubling outage pause. */
  outageStrikes: integer("outage_strikes").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Bookmarks are ONE private set per user, not a list inside a collection.
 * They can be filtered by the feed they came from, or by the collections that
 * feed is in, but that is a query-time join, never stored membership.
 * Decided 2026-09-11 after the collection-scoped version felt wrong in use.
 */
export const bookmarks = pgTable("bookmarks", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: bigint("user_id", { mode: "number" }).notNull().references(() => users.id, { onDelete: "cascade" }),
  /** Optional back-references for filtering; the snapshot below is the source
   *  of truth so pruning items or unfollowing feeds can never break a bookmark. */
  itemId: bigint("item_id", { mode: "number" }).references(() => items.id, { onDelete: "set null" }),
  feedId: bigint("feed_id", { mode: "number" }).references(() => feeds.id, { onDelete: "set null" }),
  url: text("url").notNull(),
  title: text("title"),
  summary: text("summary"),
  imageUrl: text("image_url"),
  siteTitle: text("site_title"),
  author: text("author"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  note: text("note"),
  /**
   * Not enforced anywhere: bookmarks_visibility governs the whole set, and
   * per-bookmark overrides are deliberately out of scope for now (collections
   * are the only thing with an individual setting). Kept for when they are not
   * — see backlog/per-bookmark-visibility.md.
   */
  isPublic: boolean("is_public").notNull().default(false),
  savedAt: timestamp("saved_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("bookmarks_user_url_uq").on(t.userId, t.url),
  index("bookmarks_user_saved_idx").on(t.userId, t.savedAt),
]);

/**
 * Notes: one short Markdown note per (user, post). The first social object.
 * Attached to the item itself, not to a feed, collection or bookmark, so you
 * can note anything you run across, including posts in someone else's
 * collection you never followed. Capped at NOTE_MAX characters (see
 * routes/notes.ts) to keep this a margin note, not a blog. created_at is when
 * the thought was first written down; updated_at moves on every edit.
 * Visibility is derived at read time: the author's profile must be public and
 * show_notes on, and the reader's notes_from must admit the author.
 */
export const notes = pgTable("notes", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: bigint("user_id", { mode: "number" }).notNull().references(() => users.id, { onDelete: "cascade" }),
  itemId: bigint("item_id", { mode: "number" }).notNull().references(() => items.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("notes_user_item_uq").on(t.userId, t.itemId),
  index("notes_item_idx").on(t.itemId),
  index("notes_user_created_idx").on(t.userId, t.createdAt),
]);

/**
 * People following people. One-directional, like a feed follow: "friends" in
 * the UI means the people you follow. Drives which notes you see and the
 * "people I follow" filter on Explore. Nothing is sent to the followee yet.
 */
export const userFollows = pgTable("user_follows", {
  followerId: bigint("follower_id", { mode: "number" }).notNull().references(() => users.id, { onDelete: "cascade" }),
  followeeId: bigint("followee_id", { mode: "number" }).notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.followerId, t.followeeId] }),
  index("user_follows_followee_idx").on(t.followeeId),
]);

export const blocks = pgTable("blocks", {
  userId: bigint("user_id", { mode: "number" }).notNull().references(() => users.id, { onDelete: "cascade" }),
  feedId: bigint("feed_id", { mode: "number" }).notNull().references(() => feeds.id, { onDelete: "cascade" }),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.userId, t.feedId] })]);

export const events = pgTable("events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: bigint("user_id", { mode: "number" }).references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("events_created_idx").on(t.createdAt)]);

/** One row per fetch attempt. Operational, prunable. */
export const fetchLog = pgTable("fetch_log", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  feedId: bigint("feed_id", { mode: "number" }).notNull().references(() => feeds.id, { onDelete: "cascade" }),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  status: integer("status"),
  durationMs: integer("duration_ms"),
  itemsNew: integer("items_new"),
  error: text("error"),
}, (t) => [index("fetch_log_feed_at_idx").on(t.feedId, t.at)]);
