/**
 * YouTube never advertises its feeds on video pages and only sometimes on
 * channel pages, but every channel has one at a fixed address:
 *   https://www.youtube.com/feeds/videos.xml?channel_id=UC…
 * (and every playlist at …?playlist_id=…). So any YouTube URL a person is
 * likely to paste can be turned into the channel's feed:
 *
 *   youtube.com/channel/UC…          → the channel, no fetch: offer both feeds
 *   youtube.com/playlist?list=…      → the playlist feed, no fetch
 *   youtube.com/feeds/videos.xml?…   → already a feed
 *   youtube.com/@handle, /c/name, /user/name
 *                                    → fetch the channel page, read its id
 *   youtube.com/watch?v=…, youtu.be/…, /shorts/…, /live/…, /embed/…
 *                                    → fetch the video page, read the OWNER's
 *                                      channel id (watch pages also mention
 *                                      the channels of recommended videos, so
 *                                      only the videoDetails block counts)
 *
 * Returns null for anything that is not YouTube, so discovery proceeds as
 * usual. Throws when it is YouTube but the channel can't be found (a consent
 * wall, a removed video), with a message the add sheet can show.
 *
 * ## Two feeds per channel
 *
 * A channel's uploads and its Shorts arrive in one YouTube feed, and most
 * people want one or the other, so a channel address offers both and the add
 * sheet asks. They are two ordinary feed addresses, so they are two feeds
 * everywhere else in thicket — separate rows, separate entries in the index,
 * either one followable on its own:
 *
 *   All videos → …/feeds/videos.xml?channel_id=UC…   YouTube's own feed
 *   No Shorts  → …/playlist?list=UULF…               the channel's Videos tab
 *
 * The second address is a real page — open it and you see exactly the videos
 * it promises — but it is not a feed, so thicket fetches the channel's Atom
 * feed and drops the Shorts out of it (see `youTubeVariant`).
 *
 * Telling a Short from an upload turns out to be free, because YouTube already
 * says so in the feed: a Short's entry links to /shorts/<id> and an ordinary
 * upload's to /watch?v=<id>. That is not a flag we read into the document, it
 * is the video's address. Across the 6,394 YouTube items this instance has
 * stored from 416 channels, going back to 2009, those are the only two shapes
 * that have ever appeared, the oldest /shorts/ link is from October 2021 (when
 * Shorts launched), and 276 of the 416 channels post them. Verified against two
 * independent sources before being trusted: the channel's Videos tab as a page
 * (youtube.com/playlist?list=UULF…) and youtube.com/shorts/<id>, which serves a
 * Short but 303s an ordinary video to /watch. All three agreed on every entry.
 *
 * So no extra request, and nothing scraped out of HTML. The redirect above is
 * kept only as a fallback for an entry whose link can't be read at all, which
 * has not happened yet: no stored YouTube item is missing one.
 *
 * Three things that do NOT work, recorded so nobody tries them again:
 *
 *  - videos.xml?playlist_id=UULF… would be the tidy answer. That endpoint 404s
 *    for the auto-generated tab playlists, and in testing 404'd for ordinary
 *    PL… playlists too, while channel_id answered 200 on every attempt in the
 *    same minute. YouTube's playlist feeds look dead generally.
 *  - Nor can the second address just be the first with a flag on it: YouTube
 *    rejects unknown query parameters on videos.xml outright (channel_id plus
 *    anything else → 400 or 404, four attempts out of four, against four out of
 *    four 200s for channel_id alone).
 *  - Nothing else in the entry helps: no duration, no aspect ratio, no
 *    category. Drop the link and the two kinds are identical.
 *
 * An entry that cannot be classified at all is treated as a Short and left out,
 * because the address promised no Shorts. Nothing is lost by that: the next
 * refresh still sees it among the channel's fifteen and reconsiders it.
 */
import { httpGet } from "./http.js";
import type { Candidate } from "./discover.js";
import type { ParsedFeed, ParsedItem } from "./parse.js";

const CHANNEL_SUFFIX = "[\\w-]{22}";
const CHANNEL_ID = `UC${CHANNEL_SUFFIX}`;
const VIDEO_ID = "[\\w-]{11}";
const YT_HOST = /^(www\.|m\.|music\.)?youtube\.com$/i;
const SHORT_HOST = /^(www\.)?youtu\.be$/i;
/** The Videos tab of a channel is the auto-playlist UULF + the channel id's suffix. */
const NO_SHORTS_LIST = new RegExp(`^UULF(${CHANNEL_SUFFIX})$`);
/** YouTube serves the full page (with its JSON blobs) to a stated language, and the consent cookie skips the EU wall. */
const PAGE_HEADERS = { accept: "text/html,application/xhtml+xml", "accept-language": "en-US,en;q=0.9", cookie: "CONSENT=YES+cb; SOCS=CAI" };

export const channelFeedUrl = (channelId: string) => `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
export const playlistFeedUrl = (playlistId: string) => `https://www.youtube.com/feeds/videos.xml?playlist_id=${encodeURIComponent(playlistId)}`;
/** The channel's Videos tab: every upload that isn't a Short. A page rather than a feed — see `youTubeVariant`. */
export const noShortsFeedUrl = (channelId: string) => `https://www.youtube.com/playlist?list=UULF${channelId.slice(2)}`;

export function isYouTubeUrl(input: string): boolean {
  try { const u = new URL(input); return YT_HOST.test(u.hostname) || SHORT_HOST.test(u.hostname); } catch { return false; }
}

export type YouTubeResolution =
  | { feedUrl: string; via: "feed" | "playlist" | "no-shorts" }
  | { pageUrl: string; candidates: Candidate[] };

/** The two ways to follow a channel. Shorts-and-all first: it is the whole channel, and what the address literally names. */
export function channelCandidates(channelId: string): Candidate[] {
  return [
    { url: channelFeedUrl(channelId), title: "All videos", note: "Everything the channel posts, Shorts included", kind: "atom" },
    { url: noShortsFeedUrl(channelId), title: "No Shorts", note: "Regular videos only", kind: "atom" },
  ];
}

/** Pull the channel id out of a fetched YouTube page. `video` = only trust the owner block. */
export function extractChannelId(html: string, video: boolean): string | null {
  const owner = new RegExp(`"videoDetails":\\{[^{}]*?"channelId":"(${CHANNEL_ID})"`).exec(html)?.[1];
  if (owner) return owner;
  if (video) {
    // The owner block moved? Fall back to the id that sits next to isOwnerViewing, which is the video's own channel.
    return new RegExp(`"channelId":"(${CHANNEL_ID})","isOwnerViewing"`).exec(html)?.[1] ?? null;
  }
  return (
    new RegExp(`"externalId":"(${CHANNEL_ID})"`).exec(html)?.[1] ??
    new RegExp(`<link rel="canonical" href="https://www\\.youtube\\.com/channel/(${CHANNEL_ID})"`).exec(html)?.[1] ??
    new RegExp(`feeds/videos\\.xml\\?channel_id=(${CHANNEL_ID})`).exec(html)?.[1] ??
    new RegExp(`<meta itemprop="channelId" content="(${CHANNEL_ID})"`).exec(html)?.[1] ??
    new RegExp(`"channelId":"(${CHANNEL_ID})"`).exec(html)?.[1] ??
    null
  );
}

export async function resolveYouTube(input: string): Promise<YouTubeResolution | null> {
  let u: URL;
  try { u = new URL(input); } catch { return null; }
  const short = SHORT_HOST.test(u.hostname);
  if (!short && !YT_HOST.test(u.hostname)) return null;
  const path = u.pathname.replace(/\/+$/, "");
  const seg = path.split("/").filter(Boolean);
  const choose = (channelId: string): YouTubeResolution => ({ pageUrl: `https://www.youtube.com/channel/${channelId}`, candidates: channelCandidates(channelId) });

  if (path === "/feeds/videos.xml" && (u.searchParams.get("channel_id") || u.searchParams.get("playlist_id") || u.searchParams.get("user"))) {
    return { feedUrl: u.toString(), via: "feed" };
  }
  if (path === "/playlist" && u.searchParams.get("list")) {
    const list = u.searchParams.get("list")!;
    // The Videos tab, pasted or re-imported: the same feed thicket offers as "No Shorts".
    const tab = NO_SHORTS_LIST.exec(list);
    if (tab) return { feedUrl: noShortsFeedUrl(`UC${tab[1]}`), via: "no-shorts" };
    return { feedUrl: playlistFeedUrl(list), via: "playlist" };
  }
  const direct = new RegExp(`^/channel/(${CHANNEL_ID})`).exec(path);
  if (direct) return choose(direct[1]);

  // Something that names a video: we need the page to learn whose it is.
  let videoId: string | null = null;
  if (short) videoId = seg[0] ?? null;
  else if (path === "/watch") videoId = u.searchParams.get("v");
  else if (seg.length >= 2 && ["shorts", "live", "embed", "v"].includes(seg[0])) videoId = seg[1];
  if (videoId && /^[\w-]{6,20}$/.test(videoId)) {
    const page = await fetchPage(`https://www.youtube.com/watch?v=${videoId}`);
    const id = extractChannelId(page, true);
    if (!id) throw new Error("Found the YouTube video but not the channel it belongs to.");
    return choose(id);
  }

  // Something that names a channel by handle or legacy name.
  let channelPath: string | null = null;
  if (seg[0]?.startsWith("@")) channelPath = `/${seg[0]}`;
  else if ((seg[0] === "c" || seg[0] === "user") && seg[1]) channelPath = `/${seg[0]}/${seg[1]}`;
  if (channelPath) {
    const page = await fetchPage(`https://www.youtube.com${channelPath}`);
    const id = extractChannelId(page, false);
    if (!id) throw new Error("Found the YouTube page but not its channel id.");
    return choose(id);
  }
  return null; // youtube.com/something-else: let ordinary discovery have a go
}

/**
 * A feed address thicket derives rather than fetches. Returns null for every
 * ordinary address, so callers can treat it as "fetch this instead, then
 * narrow what came back". Used by discovery's first fetch and by every
 * refresh after it, so both store the same thing.
 */
export type YouTubeVariant = {
  /** What to actually request. */
  fetchUrl: string;
  /** Narrow and relabel the document to match what the address promised. */
  transform: (parsed: ParsedFeed) => Promise<ParsedFeed>;
};

export function youTubeVariant(feedUrl: string): YouTubeVariant | null {
  let u: URL;
  try { u = new URL(feedUrl); } catch { return null; }
  if (!YT_HOST.test(u.hostname) || u.pathname.replace(/\/+$/, "") !== "/playlist") return null;
  const tab = NO_SHORTS_LIST.exec(u.searchParams.get("list") ?? "");
  if (!tab) return null;
  return { fetchUrl: channelFeedUrl(`UC${tab[1]}`), transform: dropShorts };
}

/** Is this entry a Short? Read off its own address: /shorts/<id> vs /watch?v=<id>. Null when it says neither. */
function shortFromLink(item: ParsedItem): boolean | null {
  if (!item.url) return null;
  try {
    const u = new URL(item.url);
    if (!YT_HOST.test(u.hostname)) return null;
    if (new RegExp(`^/shorts/${VIDEO_ID}`).test(u.pathname)) return true;
    if (u.pathname === "/watch" && u.searchParams.get("v")) return false;
    return null;
  } catch {
    return null;
  }
}

/** youtube.com/shorts/<id> serves a Short; a regular video 303s to /watch. Null when YouTube said neither. */
async function isShort(videoId: string): Promise<boolean | null> {
  try {
    const res = await httpGet(`https://www.youtube.com/shorts/${videoId}`, PAGE_HEADERS, { redirect: "manual" });
    if (res.status === 200) return true;
    if (res.status >= 300 && res.status < 400) return /\/watch\b/.test(res.headers.get("location") ?? "") ? false : null;
    return null;
  } catch {
    return null;
  }
}

function videoIdOf(item: ParsedItem): string | null {
  const fromKey = new RegExp(`^guid:yt:video:(${VIDEO_ID})$`).exec(item.dedupeKey)?.[1];
  if (fromKey) return fromKey;
  if (!item.url) return null;
  try {
    const u = new URL(item.url);
    const v = u.searchParams.get("v");
    if (v && new RegExp(`^${VIDEO_ID}$`).test(v)) return v;
    return new RegExp(`^/(?:shorts|live|embed|v)/(${VIDEO_ID})`).exec(u.pathname)?.[1] ?? null;
  } catch {
    return null;
  }
}

async function dropShorts(parsed: ParsedFeed): Promise<ParsedFeed> {
  // The title distinguishes the two feeds wherever they sit side by side: the index, a collection, a river byline.
  const title = parsed.title ? `${parsed.title} (no Shorts)` : null;
  const keep: ParsedItem[] = [];
  for (const item of parsed.items) {
    const fromLink = shortFromLink(item);
    if (fromLink !== null) {
      if (!fromLink) keep.push(item);
      continue;
    }
    // An entry whose address says neither. Ask YouTube about the video itself.
    const id = videoIdOf(item);
    if (id && (await isShort(id)) === false) keep.push(item);
  }
  return { ...parsed, title, items: keep };
}

/** A browser-ish request: YouTube serves the full page (with its JSON blobs) to a stated language, and the consent cookie skips the EU wall. */
async function fetchPage(url: string): Promise<string> {
  const res = await httpGet(url, PAGE_HEADERS);
  if (res.status >= 400) throw new Error(`YouTube answered HTTP ${res.status} for ${url}`);
  return res.body;
}
