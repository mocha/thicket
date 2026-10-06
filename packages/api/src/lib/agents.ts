/**
 * Wayfinding for AI agents and other programs (issue #53). The web app is a
 * static SPA, so anything that reads a page without running its JavaScript
 * gets an empty shell. Rather than a second set of views, thicket points such
 * readers at the JSON the app itself is built from:
 *
 * - /llms.txt says what thicket is, how pages map to the API, and how a
 *   person's API token unlocks the rest (served by index.ts).
 * - Every page served from the SPA fallback carries `<link rel="alternate"
 *   type="application/json">` to its data and a <noscript> note saying so.
 *
 * DATA_FOR is the one map from pages to endpoints. agents.test.ts checks each
 * endpoint it names against the published API description (lib/openapi.ts).
 */
import { LIMITS } from "./ratelimit.js";

type Data = { api: string; about: string };
/** A page of the web app. `pattern`'s named groups fill the `:params` in each `api`. */
type Page = { page: string; pattern: RegExp; data: Data[]; token?: boolean };

/** Page → the API calls that hold what it shows. Order matters: a post's page before its feed's. */
export const DATA_FOR: Page[] = [
  { page: "/feeds/:id/:slug/:item", pattern: /^\/feeds\/\d+\/[^/]+\/(?<item>\d+)(?:\/[^/]*)?\/?$/, data: [
    { api: "/api/items/:item", about: "the post" },
  ] },
  { page: "/feeds/:id", pattern: /^\/feeds\/(?<id>\d+)(?:\/(?!settings\/?$)[^/]+)?\/?$/, data: [
    { api: "/api/feeds/:id", about: "the feed" },
    { api: "/api/river?feed=:id", about: "its posts, newest first" },
  ] },
  { page: "/@:handle/collections/:slug", pattern: /^\/@(?<handle>[^/]+)\/collections\/(?<slug>[^/]+)\/?$/, data: [
    { api: "/api/profiles/:handle/collections/:slug", about: "the collection and its feeds" },
    { api: "/api/profiles/:handle/collections/:slug/opml", about: "the collection as OPML" },
  ] },
  { page: "/@:handle/bookmarks", pattern: /^\/@(?<handle>[^/]+)\/(?:bookmarks|notes)\/?$/, data: [
    { api: "/api/profiles/:handle/bookmarks", about: "their shared bookmarks and notes" },
  ] },
  { page: "/@:handle", pattern: /^\/@(?<handle>[^/]+)\/?$/, data: [
    { api: "/api/profiles/:handle", about: "the profile and its shared collections" },
    { api: "/api/profiles/:handle/activity", about: "recent activity" },
  ] },
  { page: "/explore", pattern: /^\/explore\/?$/, data: [
    { api: "/api/explore/collections", about: "shared collections" },
    { api: "/api/explore/users", about: "people with public profiles" },
  ] },
  { page: "/new-posts", pattern: /^\/(?:new-posts|everything)\/?$/, token: true, data: [
    { api: "/api/river", about: "every post from the feeds I follow, newest first" },
  ] },
  { page: "/collections", pattern: /^\/collections\/?$/, token: true, data: [{ api: "/api/collections", about: "my collections" }] },
  { page: "/bookmarks", pattern: /^\/bookmarks\/?$/, token: true, data: [{ api: "/api/bookmarks", about: "my bookmarks and notes" }] },
  { page: "/notifications", pattern: /^\/notifications\/?$/, token: true, data: [{ api: "/api/notifications", about: "my notifications" }] },
];

/** The data behind a page, with its addresses filled in, or [] for a page that has none to offer. */
export function dataForPath(path: string): Data[] {
  for (const p of DATA_FOR) {
    const m = p.pattern.exec(path);
    if (!m) continue;
    try {
      const fill = (api: string) => api.replace(/:([a-z]+)/g, (_, name: string) => encodeURIComponent(decodeURIComponent(m.groups![name])));
      return p.data.map((d) => ({ ...d, api: fill(d.api) }));
    } catch {
      return []; // a malformed %-escape in the address
    }
  }
  return [];
}

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

/** `<link rel="alternate">` tags for the page's <head>. */
export function alternateLinks(path: string, publicUrl: string): string[] {
  return dataForPath(path).map((d) => `<link rel="alternate" type="application/json" title="${esc(d.about)}" href="${esc(publicUrl + d.api)}" />`);
}

/** A note for readers that don't run JavaScript, placed at the top of <body>. */
export function noscriptNote(path: string, publicUrl: string): string {
  const data = dataForPath(path);
  const list = data.length
    ? ` This page’s data is available as JSON: ${data.map((d) => `<a href="${esc(publicUrl + d.api)}">${esc(d.about)}</a>`).join(", ")}.`
    : "";
  return `<noscript><p>thicket is a feed reader that runs in the browser with JavaScript.${list} For programs and AI agents, <a href="${esc(publicUrl)}/llms.txt">/llms.txt</a> explains how to read thicket through its API.</p></noscript>`;
}

/** /llms.txt (https://llmstxt.org): what this instance is and how a program reads it. */
export function llmsTxt(site: string, publicUrl: string): string {
  const burst = LIMITS.tokenBurst, hourly = LIMITS.tokenHourly;
  const pages = DATA_FOR.map((p) =>
    `- \`${p.page}\`${p.token ? " (needs a token)" : ""}: ${p.data.map((d) => `\`${d.api}\` (${d.about})`).join(", ")}`);
  return `# ${site}

> ${site === "thicket" ? "thicket is a feed reader" : `${site} runs thicket, a feed reader`} where people follow RSS, Atom and YouTube feeds, keep them in collections, save posts as bookmarks and write notes on them. The web app runs in the browser with JavaScript, so its pages are empty to programs. Read the JSON API instead; it is the same data the app shows.

Public things (profiles that are shared publicly, their shared collections and bookmarks, every feed and post) can be read without signing in. A person's own reading (New posts, their collections, bookmarks and notifications) needs an API token that person creates on their Account page (${publicUrl}/account). If you are acting for someone and need their own data, ask them for one.

## Using the API

- Send the token on every request as \`Authorization: Bearer <token>\`. A read-only token starts \`thk_ro_\`; a full access token, which can also follow feeds, save bookmarks and write notes, starts \`thk_rw_\`.
- A token can make ${burst.limit} requests in any ${burst.windowMs / 1000} seconds and ${hourly.limit} in any hour. Past that the answer is 429 with \`Retry-After\` in seconds.
- Lists page with \`nextCursor\` (send back as \`before\`) or \`nextOffset\` (send back as \`offset\`). Errors are JSON: \`{ "error": "…" }\`.
- Signed out, post lists stop after the first page on some instances.

## Docs

- [OpenAPI description](${publicUrl}/api/openapi.json): every endpoint a token can reach, its parameters and the token kind it needs.

## Pages and their data

Each page of the web app at ${publicUrl} is built from these endpoints. Pages also link to their data with \`<link rel="alternate" type="application/json">\`.

${pages.join("\n")}
- Search: \`/api/search?q=…\` (feeds, collections, posts and people)
`;
}
