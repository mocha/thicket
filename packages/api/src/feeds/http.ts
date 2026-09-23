/**
 * One HTTP client for everything we pull from the open web. Polite by default:
 * every request waits its host's turn, and a host that says slow down is
 * paused for everyone (feeds/hosts.ts). Nothing should call fetch() on the
 * open web directly.
 */
import { afterResponse, awaitTurn } from "./hosts.js";

export const USER_AGENT = "thicket/0.1 (feed reader; +https://github.com/mocha/thicket)";
export const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 20_000;

export type HttpResult = {
  status: number;
  finalUrl: string;
  headers: Headers;
  body: string;
  /** The body stopped at `maxBytes` because `truncate` was set; what we have is only the beginning. */
  truncated: boolean;
};

/** The body was bigger than we accept. The message keeps "too large" because the importer and survey match on it. */
export class TooLargeError extends Error {
  constructor(readonly bytes: number) {
    super(`response too large (${bytes} bytes)`);
  }
}

export type HttpBytes = Omit<HttpResult, "body" | "truncated"> & { bytes: Buffer };

export type HttpOptions = {
  redirect?: RequestRedirect;
  /** Largest body to accept. Over it the request fails, unless `truncate` is set. */
  maxBytes?: number;
  /** Keep the first `maxBytes` and stop downloading, rather than failing. For pages we only need the top of. */
  truncate?: boolean;
};

const FEED_ACCEPT = "application/rss+xml, application/atom+xml, application/feed+json, application/xml;q=0.9, text/html;q=0.8, */*;q=0.5";

export async function httpGet(url: string, extra: Record<string, string> = {}, opts: HttpOptions = {}): Promise<HttpResult> {
  const { res, bytes, truncated } = await request(url, { accept: FEED_ACCEPT, ...extra }, opts);
  return { status: res.status, finalUrl: res.url || url, headers: res.headers, body: bytes.length ? decode(bytes, res.headers.get("content-type")) : "", truncated };
}

/** The same polite request, for images and anything else that isn't text. */
export async function httpGetBytes(url: string, extra: Record<string, string> = {}, opts: HttpOptions = {}): Promise<HttpBytes> {
  const { res, bytes } = await request(url, { accept: "image/*, */*;q=0.5", ...extra }, opts);
  return { status: res.status, finalUrl: res.url || url, headers: res.headers, bytes };
}

async function request(url: string, headers: Record<string, string>, opts: HttpOptions) {
  const host = await awaitTurn(url);
  const res = await fetch(url, {
    headers: { "user-agent": USER_AGENT, ...headers },
    redirect: opts.redirect ?? "follow",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  await afterResponse(host, res.status, res.headers);
  const limit = opts.maxBytes ?? MAX_BYTES;
  if (res.status === 304 || !res.body) return { res, bytes: Buffer.alloc(0), truncated: false };
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > limit && !opts.truncate) {
    await res.body.cancel().catch(() => {});
    throw new TooLargeError(len);
  }
  return { res, ...(await readUpTo(res.body, limit, !!opts.truncate)) };
}

/** Read a body up to `limit` bytes. Past it: stop downloading, then either fail or keep what arrived. */
async function readUpTo(body: ReadableStream<Uint8Array>, limit: number, truncate: boolean): Promise<{ bytes: Buffer; truncated: boolean }> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      if (!truncate) throw new TooLargeError(total);
      return { bytes: Buffer.concat(chunks, total).subarray(0, limit), truncated: true };
    }
  }
  return { bytes: Buffer.concat(chunks, total), truncated: false };
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
