/**
 * YouTube never advertises its feeds on video pages and only sometimes on
 * channel pages, but every channel has one at a fixed address:
 *   https://www.youtube.com/feeds/videos.xml?channel_id=UC…
 * (and every playlist at …?playlist_id=…). So any YouTube URL a person is
 * likely to paste can be turned into the channel's feed:
 *
 *   youtube.com/channel/UC…          → straight to the feed, no fetch
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
 */
import { httpGet } from "./http.js";

const CHANNEL_ID = "UC[\\w-]{22}";
const YT_HOST = /^(www\.|m\.|music\.)?youtube\.com$/i;
const SHORT_HOST = /^(www\.)?youtu\.be$/i;

export const channelFeedUrl = (channelId: string) => `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
export const playlistFeedUrl = (playlistId: string) => `https://www.youtube.com/feeds/videos.xml?playlist_id=${encodeURIComponent(playlistId)}`;

export function isYouTubeUrl(input: string): boolean {
  try { const u = new URL(input); return YT_HOST.test(u.hostname) || SHORT_HOST.test(u.hostname); } catch { return false; }
}

export type YouTubeResolution = { feedUrl: string; via: "feed" | "channel" | "playlist" | "channel-page" | "video" };

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

  if (path === "/feeds/videos.xml" && (u.searchParams.get("channel_id") || u.searchParams.get("playlist_id") || u.searchParams.get("user"))) {
    return { feedUrl: u.toString(), via: "feed" };
  }
  const direct = new RegExp(`^/channel/(${CHANNEL_ID})`).exec(path);
  if (direct) return { feedUrl: channelFeedUrl(direct[1]), via: "channel" };
  if (path === "/playlist" && u.searchParams.get("list")) return { feedUrl: playlistFeedUrl(u.searchParams.get("list")!), via: "playlist" };

  // Something that names a video: we need the page to learn whose it is.
  let videoId: string | null = null;
  if (short) videoId = seg[0] ?? null;
  else if (path === "/watch") videoId = u.searchParams.get("v");
  else if (seg.length >= 2 && ["shorts", "live", "embed", "v"].includes(seg[0])) videoId = seg[1];
  if (videoId && /^[\w-]{6,20}$/.test(videoId)) {
    const page = await fetchPage(`https://www.youtube.com/watch?v=${videoId}`);
    const id = extractChannelId(page, true);
    if (!id) throw new Error("Found the YouTube video but not the channel it belongs to.");
    return { feedUrl: channelFeedUrl(id), via: "video" };
  }

  // Something that names a channel by handle or legacy name.
  let channelPath: string | null = null;
  if (seg[0]?.startsWith("@")) channelPath = `/${seg[0]}`;
  else if ((seg[0] === "c" || seg[0] === "user") && seg[1]) channelPath = `/${seg[0]}/${seg[1]}`;
  if (channelPath) {
    const page = await fetchPage(`https://www.youtube.com${channelPath}`);
    const id = extractChannelId(page, false);
    if (!id) throw new Error("Found the YouTube page but not its channel id.");
    return { feedUrl: channelFeedUrl(id), via: "channel-page" };
  }
  return null; // youtube.com/something-else: let ordinary discovery have a go
}

/** A browser-ish request: YouTube serves the full page (with its JSON blobs) to a stated language, and the consent cookie skips the EU wall. */
async function fetchPage(url: string): Promise<string> {
  const res = await httpGet(url, { accept: "text/html,application/xhtml+xml", "accept-language": "en-US,en;q=0.9", cookie: "CONSENT=YES+cb; SOCS=CAI" });
  if (res.status >= 400) throw new Error(`YouTube answered HTTP ${res.status} for ${url}`);
  return res.body;
}
