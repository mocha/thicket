/**
 * Server-rendered <head> for public pages. The web app is a static SPA, so
 * link unfurlers (chat apps, Mastodon, search engines) never run its
 * JavaScript. For the paths that are meant to be shared, /@handle and
 * /@handle/collections/slug, the API injects title, description, Open Graph
 * tags and the OPML alternate link into index.html before serving it. The
 * same visibility rules as the JSON endpoints apply, evaluated as an
 * anonymous viewer: private things get the generic head, not a description.
 */
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { PUBLIC_URL } from "./config.js";
import { publicStatus } from "./instance.js";
import { feedSlugSql } from "./slug.js";

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
const meta = (p: string, v: string) => `<meta property="${p}" content="${esc(v)}" />`;

type Head = { title: string; description: string; url: string; type?: string; extra?: string[] };

function render(h: Head, site: string): string {
  const title = h.title === site ? site : `${h.title} · ${site}`;
  return [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(h.description)}" />`,
    meta("og:site_name", site), meta("og:type", h.type ?? "website"), meta("og:title", h.title),
    meta("og:description", h.description), meta("og:url", h.url),
    `<meta name="twitter:card" content="summary" />`,
    `<link rel="canonical" href="${esc(h.url)}" />`,
    ...(h.extra ?? []),
  ].join("\n\t\t");
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

async function profileHead(handle: string): Promise<Head | null> {
  const rows = await db.execute<{ handle: string; displayName: string | null; bio: string | null; showCollections: boolean; following: number; collections: number }>(sql`
    select u.handle, u.display_name as "displayName", u.bio, (u.collections_visibility = 'public') as "showCollections",
           (select count(distinct cf.feed_id)::int from collection_feeds cf join collections col on col.id = cf.collection_id where col.user_id = u.id) as following,
           (select count(*)::int from collections col where col.user_id = u.id and col.parent_id is not null and col.visibility = 'public') as collections
    from users u where u.handle = ${handle.toLowerCase()} and u.profile_visibility = 'public'
  `);
  const u = rows.rows[0];
  if (!u) return null;
  const name = u.displayName ? `${u.displayName} (@${u.handle})` : `@${u.handle}`;
  const facts = [plural(u.following, "feed") + " followed", u.showCollections ? plural(u.collections, "public collection") : null].filter(Boolean).join(", ");
  return { title: name, description: u.bio ? `${u.bio} — ${facts}` : facts, url: `${PUBLIC_URL}/@${u.handle}`, type: "profile" };
}

async function collectionHead(handle: string, slug: string): Promise<Head | null> {
  const rows = await db.execute<{ handle: string; displayName: string | null; name: string; description: string | null; feeds: number; titles: string[] | null }>(sql`
    with recursive t as (
      select col.id, col.parent_id, col.name, col.slug, col.description, col.visibility, 0 as depth from collections col
        join users u on u.id = col.user_id where u.handle = ${handle.toLowerCase()} and u.profile_visibility = 'public' and u.collections_visibility = 'public' and col.parent_id is null
      union all select col.id, col.parent_id, col.name, col.slug, col.description, col.visibility, t.depth + 1 from collections col join t on col.parent_id = t.id
    ), pick as (select * from t where slug = ${slug} and depth > 0 and visibility = 'public' order by depth limit 1)
    select u.handle, u.display_name as "displayName", p.name, p.description,
           (select count(*)::int from collection_feeds cf where cf.collection_id = p.id) as feeds,
           (select array_agg(x.title order by x.title) from (select coalesce(cf.title_override, f.title) as title from collection_feeds cf join feeds f on f.id = cf.feed_id where cf.collection_id = p.id and coalesce(cf.title_override, f.title) is not null limit 4) x) as titles
    from pick p join collections c on c.id = p.id join users u on u.id = c.user_id
  `);
  const r = rows.rows[0];
  if (!r) return null;
  const by = r.displayName ?? `@${r.handle}`;
  const sample = r.titles?.length ? ` Includes ${r.titles.slice(0, 3).join(", ")}${r.feeds > 3 ? " and more" : ""}.` : "";
  const url = `${PUBLIC_URL}/@${r.handle}/collections/${slug}`;
  return {
    title: `${r.name} by ${by}`,
    description: `${r.description ? r.description.replace(/([^.!?])$/, "$1.") + " " : ""}A collection of ${plural(r.feeds, "feed")} on thicket.${sample}`,
    url,
    extra: [`<link rel="alternate" type="text/x-opml" title="${esc(r.name)}" href="${esc(url.replace(`/@${r.handle}/`, `/api/profiles/${r.handle}/`) + "/opml")}" />`],
  };
}

/** A feed page. Feeds are the instance's shared index, so there is no visibility to apply: every feed is public. */
async function feedHead(id: number): Promise<Head | null> {
  const rows = await db.execute<{ title: string | null; description: string | null; siteUrl: string | null; url: string; posts: number }>(sql`
    select f.title, f.description, f.site_url as "siteUrl", f.url,
           (select count(*)::int from items i where i.feed_id = f.id and i.published_at > now() - interval '30 days') as posts
    from feeds f where f.id = ${id}
  `);
  const f = rows.rows[0];
  if (!f) return null;
  const host = new URL(f.siteUrl ?? f.url).hostname.replace(/^www\./, "");
  const about = f.description ? f.description.trim().slice(0, 240).replace(/([^.!?])$/, "$1.") + " " : "";
  return { title: f.title ?? host, description: `${about}A feed from ${host} on thicket, ${plural(f.posts, "post")} in the last 30 days.`, url: `${PUBLIC_URL}/feeds/${id}` };
}

/**
 * A post's page. What a post is — its title, its opening line, who published
 * it — is the publisher's own shopfront copy, so an unfurl of a link someone
 * shared says what the post is. The body is not here; that is members-only and
 * lives behind /api/items/:id/content.
 */
async function itemHead(id: number): Promise<Head | null> {
  const rows = await db.execute<{ title: string | null; summary: string | null; author: string | null; imageUrl: string | null; publishedAt: string; feedId: number; feedSlug: string; feedTitle: string | null; siteUrl: string | null; url: string }>(sql`
    select i.title, i.summary, i.author, i.image_url as "imageUrl", i.published_at as "publishedAt",
           f.id as "feedId", ${feedSlugSql} as "feedSlug", f.title as "feedTitle", f.site_url as "siteUrl", f.url
    from items i join feeds f on f.id = i.feed_id where i.id = ${id}
  `);
  const it = rows.rows[0];
  if (!it) return null;
  const host = new URL(it.siteUrl ?? it.url).hostname.replace(/^www\./, "");
  const source = it.feedTitle ?? host;
  const gist = it.summary?.trim().replace(/\s+/g, " ").slice(0, 240);
  const by = it.author ? `${it.author}, ` : "";
  return {
    title: it.title ?? source,
    description: gist ? `${gist.replace(/([^.!?])$/, "$1.")} — ${by}${source}, on thicket.` : `A post by ${by}${source}, on thicket.`,
    url: `${PUBLIC_URL}/feeds/${it.feedId}/${it.feedSlug}/${id}`,
    type: "article",
    extra: it.imageUrl ? [meta("og:image", it.imageUrl)] : [],
  };
}

/** The head fragment for a path. Always returns something; public pages get specifics, everything else the instance's generic head. */
export async function headForPath(path: string): Promise<string> {
  const status = await publicStatus();
  const site = status.name;
  const generic: Head = { title: site, description: "Read the web on your own terms. Follow the sites you like and get every new post in one calm stream, newest first. No ranking, no ads, nothing about you for sale.", url: `${PUBLIC_URL}${path === "/" ? "" : path}` };
  // A post inside its feed: /feeds/:id/:slug/:item, with an optional readable tail.
  const post = /^\/feeds\/\d+\/[^/]+\/(\d+)(?:\/[^/]*)?\/?$/.exec(path);
  if (post) {
    try {
      return render((await itemHead(Number(post[1]))) ?? generic, site);
    } catch {
      return render(generic, site);
    }
  }
  const feed = /^\/feeds\/(\d+)(?:\/([^/]+))?\/?$/.exec(path);
  if (feed && feed[2] !== "settings") {
    try {
      return render((await feedHead(Number(feed[1]))) ?? generic, site);
    } catch {
      return render(generic, site);
    }
  }
  const m = /^\/@([^/]+)(?:\/collections\/([^/]+))?\/?$/.exec(path);
  if (!m) return render(generic, site);
  try {
    const h = m[2] ? await collectionHead(decodeURIComponent(m[1]), decodeURIComponent(m[2])) : await profileHead(decodeURIComponent(m[1]));
    return render(h ?? generic, site);
  } catch {
    return render(generic, site);
  }
}
