/**
 * The published description of the API, for applications and assistants:
 * an OpenAPI 3 document served at /api/openapi.json (issue #140).
 *
 * It covers exactly what an API token can reach, no more: the routes a token
 * is refused on (lib/token-access.ts) are left out, since describing them
 * would only invite calls that fail. openapi.test.ts holds the two together:
 * it fails when a route a token can reach is missing from ENDPOINTS, and when
 * ENDPOINTS lists something that is not a route or that a token cannot reach.
 *
 * Kept by hand, one line per endpoint, and deliberately modest: it says what
 * each endpoint is for, its parameters and what to send. It does not spell
 * out the shape of every answer; those are plain JSON, and the web app's
 * types (packages/web/src/lib/api.ts) are the fuller reference.
 */
import { EXPORT_MAX } from "./bookmark-export.js";
import { LIMITS } from "./ratelimit.js";
import { tokenMay } from "./token-access.js";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type Props = Record<string, string>;
type Endpoint = {
  method: Method;
  /** As the router writes it, e.g. /api/feeds/:id. */
  path: string;
  tag: string;
  summary: string;
  /** Query parameters: name → what it is. */
  query?: Props;
  /** JSON body: field → what it is. A trailing "?" on the name marks it optional. */
  body?: Props;
  /** A body that is not JSON (an OPML document). */
  rawBody?: string;
  /** What comes back when it is not JSON. */
  produces?: string;
};

const PAGE = { before: "Cursor from the previous page's `nextCursor`. Omit for the first page.", limit: "How many to return." };
const OFFSET = { offset: "How many to skip (from the previous page's `nextOffset`).", limit: "How many to return." };

export const ENDPOINTS: Endpoint[] = [
  // ---- me and this instance
  { method: "GET", path: "/api/auth/me", tag: "Account", summary: "Who this token belongs to, and their settings." },
  { method: "GET", path: "/api/auth/status", tag: "Account", summary: "This instance's name, address and sign-up policy." },

  // ---- reading
  { method: "GET", path: "/api/river", tag: "Reading", summary: "Newest posts across every feed I follow, or in one collection or one feed. Newest first.", query: { collection: "Only posts from this collection (its id).", feed: "Only posts from this feed (its id).", ...PAGE } },
  { method: "GET", path: "/api/river/stats", tag: "Reading", summary: "How many feeds and collections I follow, and what arrived in the last day." },
  { method: "GET", path: "/api/items/:id", tag: "Reading", summary: "One post: its title, link, summary, and my bookmark and note on it." },
  { method: "GET", path: "/api/items/:id/content", tag: "Reading", summary: "One post's full text as cleaned-up HTML, as the in-app reader shows it." },
  { method: "POST", path: "/api/marks/counts", tag: "Reading", summary: "How many posts in each of my collections are newer than a time I give. Reads only; nothing is stored.", body: { anchors: "An object of collection id → ISO time. The count for each collection is of posts newer than its time." } },
  { method: "GET", path: "/api/search", tag: "Reading", summary: "Search feeds, collections, posts and people.", query: { q: "What to search for.", scope: "One of all, feeds, collections, posts, people. Default all.", network: "1 to search only among people I follow.", ...OFFSET } },

  // ---- feeds
  { method: "GET", path: "/api/feeds", tag: "Feeds", summary: "Every feed on this instance, with whether I follow it and which of my collections hold it.", query: { q: "Filter by title or address.", following: "1 for only feeds I follow, 0 for only feeds I don't.", sort: "One of popular (default), title, posts, added, recent.", since: "Only feeds added in the last 24h, week, month or year.", network: "1 for feeds followed by people I follow, 2 to include the people they follow.", ...OFFSET } },
  { method: "POST", path: "/api/feeds", tag: "Feeds", summary: "Follow a feed by address. Give a site's page or its feed; thicket finds the feed. Answers `subscribed`, `choose` (several candidates to pick from) or `none`.", body: { url: "The address of a site or a feed.", "collectionId?": "The collection to put it in. Default: my first collection.", "collectionIds?": "Several collections to put it in." } },
  { method: "GET", path: "/api/feeds/:id", tag: "Feeds", summary: "One feed, with its stats and which of my collections hold it." },
  { method: "GET", path: "/api/feeds/:id/icon", tag: "Feeds", summary: "The feed's site icon, or 404 if it has none.", produces: "image/*" },
  { method: "POST", path: "/api/feeds/:id/icon/refresh", tag: "Feeds", summary: "Look for the feed's site icon again." },
  { method: "POST", path: "/api/feeds/:id/refresh", tag: "Feeds", summary: "Fetch the feed now. Answers 429 with `retryAfterS` if it was fetched in the last five minutes." },
  { method: "PUT", path: "/api/feeds/:id/settings", tag: "Feeds", summary: "My own settings for a feed: the name I see it under, and whether YouTube Shorts are left out.", body: { "displayName?": "My name for the feed, or null for its own.", "hideShorts?": "true to hide Shorts, false to show them, null to follow my default." } },
  { method: "POST", path: "/api/feeds/:id/follow", tag: "Feeds", summary: "Follow a feed thicket already knows, into my first collection or the one given.", body: { "collectionId?": "The collection to put it in." } },
  { method: "DELETE", path: "/api/feeds/:id", tag: "Feeds", summary: "Unfollow a feed: take it out of all my collections. Answers with what was removed, which `restore` takes back." },
  { method: "POST", path: "/api/feeds/:id/restore", tag: "Feeds", summary: "Undo an unfollow.", body: { collectionIds: "The collections it was in, as the unfollow returned them." } },
  { method: "PUT", path: "/api/feeds/:id/collections", tag: "Feeds", summary: "Set exactly which of my collections hold a feed.", body: { collectionIds: "The ids of the collections that should hold it. An empty list unfollows it." } },
  { method: "POST", path: "/api/feeds/:id/block", tag: "Feeds", summary: "Block a feed." },
  { method: "DELETE", path: "/api/feeds/:id/block", tag: "Feeds", summary: "Unblock a feed." },

  // ---- collections
  { method: "GET", path: "/api/collections", tag: "Collections", summary: "My collections." },
  { method: "POST", path: "/api/collections", tag: "Collections", summary: "Make a collection.", body: { name: "Its name. Must not be one I already use.", "description?": "A line about it.", "parentId?": "Leave out. Collections sit side by side." } },
  { method: "GET", path: "/api/collections/:id", tag: "Collections", summary: "One of my collections, with its feeds." },
  { method: "PATCH", path: "/api/collections/:id", tag: "Collections", summary: "Rename a collection, describe it, or change who can see it.", body: { "name?": "A new name.", "description?": "A new description.", "visibility?": "Who can see it: one of the sharing levels `/api/auth/me` reports." } },
  { method: "DELETE", path: "/api/collections/:id", tag: "Collections", summary: "Delete a collection. Feeds that were only in it stop being followed; see `orphans` first." },
  { method: "GET", path: "/api/collections/:id/orphans", tag: "Collections", summary: "The feeds that would stop being followed if this collection were deleted." },
  { method: "POST", path: "/api/collections/:id/merge", tag: "Collections", summary: "Move a collection's feeds into another of mine, then delete it.", body: { intoId: "The collection that takes the feeds." } },
  { method: "PUT", path: "/api/collections/:id/feeds/:feedId", tag: "Collections", summary: "Add a feed to a collection." },
  { method: "DELETE", path: "/api/collections/:id/feeds/:feedId", tag: "Collections", summary: "Take a feed out of a collection." },
  { method: "GET", path: "/api/collections/:id/opml", tag: "Collections", summary: "The collection as an OPML file, for any other reader.", produces: "text/x-opml" },
  { method: "POST", path: "/api/collections/:id/import", tag: "Collections", summary: "Add the feeds in an OPML document to this collection.", rawBody: "text/x-opml" },
  { method: "POST", path: "/api/collections/import-url", tag: "Collections", summary: "Copy a collection from a link: a shared thicket collection, or any OPML address.", body: { url: "The link.", "name?": "What to call the new collection." } },

  // ---- bookmarks and notes
  { method: "GET", path: "/api/bookmarks", tag: "Bookmarks and notes", summary: "My bookmarks, most recently saved or noted first. Each carries my note if it has one.", query: { feed: "Only bookmarks from this feed (its id).", collection: "Only bookmarks from feeds in this collection (its id).", notes: "1 for only the ones with a note.", ...PAGE } },
  { method: "GET", path: "/api/bookmarks/sources", tag: "Bookmarks and notes", summary: "Which feeds and collections my bookmarks come from, with counts, and how many carry a note." },
  { method: "GET", path: "/api/bookmarks/export", tag: "Bookmarks and notes", summary: `Every bookmark and its note as one bookmark file (HTML, the format browsers and bookmark services import), newest saved first. The most recent ${EXPORT_MAX.toLocaleString("en-US")} at most.`, query: { tz: "An IANA time zone (America/Chicago) for the times written in the file. UTC when absent or unknown." } },
  { method: "GET", path: "/api/bookmarks/export/info", tag: "Bookmarks and notes", summary: "How many bookmarks I have, and the most one export file carries." },
  { method: "POST", path: "/api/bookmarks", tag: "Bookmarks and notes", summary: `Save a bookmark. Send one of: \`itemId\` to save a post, \`bookmarkId\` to copy someone's public bookmark, or \`url\` to save any web address. Saving the same address twice keeps one bookmark. At most ${LIMITS.savesPerDay.limit} a day.`, body: { "itemId?": "A post's id.", "bookmarkId?": "Someone's public bookmark's id.", "url?": "A web address (http or https).", "title?": "A title, when saving by `url`." } },
  { method: "DELETE", path: "/api/bookmarks/:id", tag: "Bookmarks and notes", summary: "Remove a bookmark, and the note on it. Answers with what was removed." },
  { method: "PUT", path: "/api/bookmarks/:id/note", tag: "Bookmarks and notes", summary: `Write or rewrite my note on a bookmark. At most ${LIMITS.noteWritesPerDay.limit} note writes a day.`, body: { body: "The note, as Markdown. At most 2,000 characters." } },
  { method: "DELETE", path: "/api/bookmarks/:id/note", tag: "Bookmarks and notes", summary: "Delete my note on a bookmark. The bookmark stays." },
  { method: "PUT", path: "/api/notes/items/:itemId", tag: "Bookmarks and notes", summary: "Write or rewrite my note on a post. Writing a note saves the post as a bookmark if it isn't one yet.", body: { body: "The note, as Markdown. At most 2,000 characters." } },
  { method: "DELETE", path: "/api/notes/items/:itemId", tag: "Bookmarks and notes", summary: "Delete my note on a post. The bookmark stays." },

  // ---- people and what they share
  { method: "GET", path: "/api/profiles/:handle", tag: "People", summary: "Someone's profile, as far as they share it with me." },
  { method: "GET", path: "/api/profiles/:handle/following", tag: "People", summary: "The people someone follows, if they share that." },
  { method: "GET", path: "/api/profiles/:handle/followers", tag: "People", summary: "The people who follow me. Only for my own handle; anyone else's is a 404." },
  { method: "POST", path: "/api/profiles/:handle/follow", tag: "People", summary: "Follow a person." },
  { method: "DELETE", path: "/api/profiles/:handle/follow", tag: "People", summary: "Stop following a person." },
  { method: "GET", path: "/api/profiles/:handle/collections/:slug", tag: "People", summary: "One of someone's shared collections, with its feeds." },
  { method: "GET", path: "/api/profiles/:handle/collections/:slug/opml", tag: "People", summary: "That collection as an OPML file.", produces: "text/x-opml" },
  { method: "POST", path: "/api/profiles/:handle/collections/:slug/copy", tag: "People", summary: "Copy someone's shared collection into my own, as a separate copy." },
  { method: "GET", path: "/api/profiles/:handle/bookmarks", tag: "People", summary: "Someone's shared bookmarks, with whether I have each one too.", query: { notes: "1 for only the ones with a note.", ...PAGE } },
  { method: "GET", path: "/api/profiles/:handle/activity", tag: "People", summary: "What someone has been up to recently, as far as they share it with me.", query: PAGE },
  { method: "GET", path: "/api/users/:handle/avatar", tag: "People", summary: "Someone's picture, or 404 if they have none.", produces: "image/*" },
  { method: "GET", path: "/api/explore/collections", tag: "People", summary: "Shared collections on this instance.", query: { q: "Filter by name.", network: "1 for only collections by people I follow.", ...OFFSET } },
  { method: "GET", path: "/api/explore/users", tag: "People", summary: "People with public profiles on this instance.", query: { q: "Filter by name or handle.", ...OFFSET } },
  { method: "GET", path: "/api/explore/featured", tag: "People", summary: "The collections this instance suggests to newcomers." },
];

const NUMERIC = new Set(["id", "feedId", "itemId"]);
const secs = (ms: number) => ms / 1000;

/** The document itself. `serverUrl` is where this instance is reached. */
export function openApiDocument(serverUrl: string) {
  const burst = LIMITS.tokenBurst, hourly = LIMITS.tokenHourly;
  const paths: Record<string, Record<string, unknown>> = {};
  for (const e of ENDPOINTS) {
    const readOnlyOk = tokenMay("read", e.method, e.path.replace(/:[A-Za-z]+/g, "1")).ok;
    const params = [
      ...[...e.path.matchAll(/:([A-Za-z]+)/g)].map(([, name]) => ({ name, in: "path", required: true, schema: { type: NUMERIC.has(name) ? "integer" : "string" } })),
      ...Object.entries(e.query ?? {}).map(([name, description]) => ({ name, in: "query", required: false, description, schema: { type: "string" } })),
    ];
    const required = Object.keys(e.body ?? {}).filter((k) => !k.endsWith("?"));
    const operation: Record<string, unknown> = {
      operationId: `${e.method.toLowerCase()}${e.path.replace(/^\/api/, "").replace(/[/:-]+(\w)/g, (_, ch: string) => ch.toUpperCase())}`,
      tags: [e.tag],
      summary: e.summary,
      description: readOnlyOk ? "Works with a read-only or a full access token." : "Needs a full access token. A read-only token is refused with 403.",
      "x-token-access": readOnlyOk ? "read" : "full",
      security: [{ [readOnlyOk ? "readOnlyToken" : "fullAccessToken"]: [] }, ...(readOnlyOk ? [{ fullAccessToken: [] }] : [])],
      ...(params.length ? { parameters: params } : {}),
      ...(e.body ? { requestBody: { required: required.length > 0, content: { "application/json": { schema: {
        type: "object",
        properties: Object.fromEntries(Object.entries(e.body).map(([k, description]) => [k.replace(/\?$/, ""), { description }])),
        ...(required.length ? { required } : {}),
      } } } } } : {}),
      ...(e.rawBody ? { requestBody: { required: true, content: { [e.rawBody]: { schema: { type: "string" } } } } } : {}),
      responses: {
        "200": { description: "Done. The answer is JSON unless the summary says otherwise. A new thing answers 201, and some changes answer 204 with nothing.", content: { [e.produces ?? "application/json"]: {} } },
        "400": { $ref: "#/components/responses/Refused" },
        "401": { $ref: "#/components/responses/BadToken" },
        "403": { $ref: "#/components/responses/NotAllowed" },
        "404": { $ref: "#/components/responses/NotFound" },
        "429": { $ref: "#/components/responses/TooMany" },
      },
    };
    const path = e.path.replace(/:([A-Za-z]+)/g, "{$1}");
    (paths[path] ??= {})[e.method.toLowerCase()] = operation;
  }

  const errorBody = { "application/json": { schema: { $ref: "#/components/schemas/Error" } } };
  return {
    openapi: "3.0.3",
    info: {
      title: "thicket",
      version: "1",
      description: [
        "thicket is a feed reader: you follow feeds, keep them in collections, save posts as bookmarks and write notes on them. This describes what an application can do with it on a person's behalf, using an API token that person turned on in their Account page.",
        "",
        "**Signing requests.** Send the token on every request as `Authorization: Bearer <token>`. There are two kinds. A **read-only** token (it starts `thk_ro_`) can make every request marked as a read here, and is refused with 403 on the rest. A **full access** token (`thk_rw_`) can make every request described here. Each operation says which it needs, and carries it as `x-token-access`.",
        "",
        `**Limits.** Each token can make ${burst.limit} requests in any ${secs(burst.windowMs)} seconds and ${hourly.limit} in any hour. Past either, the answer is 429 with a \`Retry-After\` header (and \`retryAfterS\` in the body) giving the seconds to wait; waiting that long is enough. Refused requests are not counted. Saving is also limited per account, to ${LIMITS.savesPerDay.limit} bookmarks and ${LIMITS.noteWritesPerDay.limit} note writes a day.`,
        "",
        "**What a token cannot do.** Change the account (password, email, profile and sharing settings, profile picture), manage API tokens, use the import page, or reach the admin pages. Those need a person signed in to thicket in a browser, and are not described here.",
        "",
        "**Paging.** Lists return a page and either `nextCursor` (send it back as `before`) or `nextOffset` (send it back as `offset`); null means there is no more.",
        "",
        "**Errors** are JSON: `{ \"error\": \"a sentence saying what went wrong\" }`.",
      ].join("\n"),
    },
    servers: [{ url: serverUrl }],
    tags: ["Account", "Reading", "Feeds", "Collections", "Bookmarks and notes", "People"].map((name) => ({ name })),
    paths,
    components: {
      securitySchemes: {
        readOnlyToken: { type: "http", scheme: "bearer", bearerFormat: "thk_ro_…", description: "A read-only access token from the Account page. Reads only." },
        fullAccessToken: { type: "http", scheme: "bearer", bearerFormat: "thk_rw_…", description: "A full access token from the Account page. Reads and writes." },
      },
      schemas: {
        Error: { type: "object", required: ["error"], properties: { error: { type: "string", description: "What went wrong, in a sentence." }, retryAfterS: { type: "integer", description: "On a 429: seconds to wait." } } },
      },
      responses: {
        Refused: { description: "The request can't be done as sent; `error` says why.", content: errorBody },
        BadToken: { description: "The token is missing where one is needed, mistyped or revoked.", content: errorBody },
        NotAllowed: { description: "The token may not do this: it is read-only and this is a change, or it is something no token may do.", content: errorBody },
        NotFound: { description: "No such thing, or not one this account can see.", content: errorBody },
        TooMany: {
          description: `Too many requests: more than ${burst.limit} in ${secs(burst.windowMs)} seconds or ${hourly.limit} in an hour for this token, or a daily limit on saving. Wait the number of seconds in \`Retry-After\`.`,
          headers: { "Retry-After": { description: "Seconds to wait before trying again.", schema: { type: "integer" } } },
          content: errorBody,
        },
      },
    },
  };
}
