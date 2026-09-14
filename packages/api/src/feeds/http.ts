/**
 * One HTTP client for everything we pull from the open web. Polite by default:
 * every request waits its host's turn, and a host that says slow down is
 * paused for everyone (feeds/hosts.ts). Nothing should call fetch() on the
 * open web directly.
 */
import { afterResponse, awaitTurn } from "./hosts.js";

export const USER_AGENT = "thicket/0.1 (feed reader; +https://github.com/mocha/thicket)";
const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 20_000;

export type HttpResult = {
  status: number;
  finalUrl: string;
  headers: Headers;
  body: string;
};

export async function httpGet(url: string, extra: Record<string, string> = {}, opts: { redirect?: RequestRedirect } = {}): Promise<HttpResult> {
  const host = await awaitTurn(url);
  const res = await fetch(url, {
    headers: { "user-agent": USER_AGENT, accept: "application/rss+xml, application/atom+xml, application/feed+json, application/xml;q=0.9, text/html;q=0.8, */*;q=0.5", ...extra },
    redirect: opts.redirect ?? "follow",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  await afterResponse(host, res.status, res.headers);
  let body = "";
  if (res.status !== 304 && res.body) {
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > MAX_BYTES) throw new Error(`response too large (${len} bytes)`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_BYTES) throw new Error(`response too large (${buf.byteLength} bytes)`);
    body = decode(buf, res.headers.get("content-type"));
  }
  return { status: res.status, finalUrl: res.url || url, headers: res.headers, body };
}

/** Honor the declared charset when it isn't UTF-8; fall back to the XML prolog. */
function decode(buf: Buffer, contentType: string | null): string {
  let charset = /charset=["']?([\w-]+)/i.exec(contentType ?? "")?.[1];
  if (!charset) {
    const head = buf.subarray(0, 200).toString("latin1");
    charset = /encoding=["']([\w-]+)["']/i.exec(head)?.[1];
  }
  try {
    return new TextDecoder(charset ?? "utf-8").decode(buf);
  } catch {
    return buf.toString("utf8");
  }
}
