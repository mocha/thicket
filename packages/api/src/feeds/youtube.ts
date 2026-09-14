/**
 * YouTube never advertises its feeds on video pages and only sometimes on
 * channel pages, but every channel has one at a fixed address:
 *   https://www.youtube.com/feeds/videos.xml?channel_id=UC…
 * (and every playlist at …?playlist_id=…). So any YouTube URL a person is
 * likely to paste can be turned into the channel's feed:
 *
 *   youtube.com/channel/UC…          → the channel feed, no fetch
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
 * ## Shorts
 *
 * A channel's uploads and its Shorts arrive in one YouTube feed. Leaving the
 * Shorts out is a person's setting on that feed (`feed_settings.hide_shorts`),
 * applied when their river is read. It is not a second feed: a feed is the
 * address thicket fetches, and there is only one document to fetch.
 *
 * From 2026-09-13 to 2026-09-14 it *was* a second feed, "No Shorts", stored at
 * the channel's Videos tab address (playlist?list=UULF…) and made by fetching
 * the channel feed and dropping the Shorts. That address still resolves — to
 * the channel feed — and migration 0008 folded any such feed into the setting.
 *
 * Telling a Short from an upload is free, because YouTube already says so in
 * the feed: a Short's entry links to /shorts/<id> and an ordinary upload's to
 * /watch?v=<id>. That is not a flag we read into the document, it is the
 * video's address. Across the 6,394 YouTube items this instance had stored
 * from 416 channels on 2026-09-13, going back to 2009, those were the only two
 * shapes that had ever appeared, the oldest /shorts/ link was from October 2021
 * (when Shorts launched), and 276 of the 416 channels posted them. Verified
 * against two independent sources before being trusted: the channel's Videos
 * tab as a page, and youtube.com/shorts/<id>, which serves a Short but 303s an
 * ordinary video to /watch. All three agreed on every entry.
 *
 * An item whose link says neither is shown, not hidden: a setting that quietly
 * eats posts is worse than one that occasionally lets a Short through.
 *
 * Three things that do NOT work, recorded so nobody tries them again:
 *
 *  - videos.xml?playlist_id=UULF… would be the tidy way to fetch only the
 *    Videos tab. That endpoint 404s for the auto-generated tab playlists, and
 *    in testing 404'd for ordinary PL… playlists too, while channel_id
 *    answered 200 on every attempt in the same minute. YouTube's playlist
 *    feeds look dead generally.
 *  - YouTube rejects unknown query parameters on videos.xml outright
 *    (channel_id plus anything else → 400 or 404, four attempts out of four,
 *    against four out of four 200s for channel_id alone).
 *  - Nothing else in the entry helps: no duration, no aspect ratio, no
 *    category. Drop the link and the two kinds are identical.
 */
import { httpGet } from "./http.js";

const CHANNEL_SUFFIX = "[\\w-]{22}";
const CHANNEL_ID = `UC${CHANNEL_SUFFIX}`;
const YT_HOST = /^(www\.|m\.|music\.)?youtube\.com$/i;
const SHORT_HOST = /^(www\.)?youtu\.be$/i;
/** The Videos tab of a channel is the auto-playlist UULF + the channel id's suffix. */
const VIDEOS_TAB_LIST = new RegExp(`^UULF(${CHANNEL_SUFFIX})$`);
/** YouTube serves the full page (with its JSON blobs) to a stated language, and the consent cookie skips the EU wall. */
const PAGE_HEADERS = { accept: "text/html,application/xhtml+xml", "accept-language": "en-US,en;q=0.9", cookie: "CONSENT=YES+cb; SOCS=CAI" };

/** A Short's own address, as a Postgres regex over items.url. See "Shorts" above. */
export const SHORTS_URL_PATTERN = "^https?://(www\\.|m\\.)?youtube\\.com/shorts/";
/** Feeds that come from YouTube, as a case-insensitive Postgres regex over feeds.url. */
export const YOUTUBE_FEED_PATTERN = "^https?://([a-z0-9-]+\\.)?youtube\\.com/";

export const channelFeedUrl = (channelId: string) => `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
export const playlistFeedUrl = (playlistId: string) => `https://www.youtube.com/feeds/videos.xml?playlist_id=${encodeURIComponent(playlistId)}`;

export function isYouTubeUrl(input: string): boolean {
  try { const u = new URL(input); return YT_HOST.test(u.hostname) || SHORT_HOST.test(u.hostname); } catch { return false; }
}

export type YouTubeResolution = { feedUrl: string; via: "feed" | "playlist" | "channel" };

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
  const channel = (channelId: string): YouTubeResolution => ({ feedUrl: channelFeedUrl(channelId), via: "channel" });

  if (path === "/feeds/videos.xml" && (u.searchParams.get("channel_id") || u.searchParams.get("playlist_id") || u.searchParams.get("user"))) {
    return { feedUrl: u.toString(), via: "feed" };
  }
  if (path === "/playlist" && u.searchParams.get("list")) {
    const list = u.searchParams.get("list")!;
    // The Videos tab, pasted or re-imported (and the address the retired "No Shorts" feed used): the channel itself.
    const tab = VIDEOS_TAB_LIST.exec(list);
    if (tab) return channel(`UC${tab[1]}`);
    return { feedUrl: playlistFeedUrl(list), via: "playlist" };
  }
  const direct = new RegExp(`^/channel/(${CHANNEL_ID})`).exec(path);
  if (direct) return channel(direct[1]);

  // Something that names a video: we need the page to learn whose it is.
  let videoId: string | null = null;
  if (short) videoId = seg[0] ?? null;
  else if (path === "/watch") videoId = u.searchParams.get("v");
  else if (seg.length >= 2 && ["shorts", "live", "embed", "v"].includes(seg[0])) videoId = seg[1];
  if (videoId && /^[\w-]{6,20}$/.test(videoId)) {
    const page = await fetchPage(`https://www.youtube.com/watch?v=${videoId}`);
    const id = extractChannelId(page, true);
    if (!id) throw new Error("Found the YouTube video but not the channel it belongs to.");
    return channel(id);
  }

  // Something that names a channel by handle or legacy name.
  let channelPath: string | null = null;
  if (seg[0]?.startsWith("@")) channelPath = `/${seg[0]}`;
  else if ((seg[0] === "c" || seg[0] === "user") && seg[1]) channelPath = `/${seg[0]}/${seg[1]}`;
  if (channelPath) {
    const page = await fetchPage(`https://www.youtube.com${channelPath}`);
    const id = extractChannelId(page, false);
    if (!id) throw new Error("Found the YouTube page but not its channel id.");
    return channel(id);
  }
  return null; // youtube.com/something-else: let ordinary discovery have a go
}

/** A browser-ish request: YouTube serves the full page (with its JSON blobs) to a stated language, and the consent cookie skips the EU wall. */
async function fetchPage(url: string): Promise<string> {
  const res = await httpGet(url, PAGE_HEADERS);
  if (res.status >= 400) throw new Error(`YouTube answered HTTP ${res.status} for ${url}`);
  return res.body;
}
