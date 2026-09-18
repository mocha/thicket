/**
 * Search: one query box over everything this instance holds.
 *
 * The shape comes from one observation (backlog/search.md, 2026-09-13):
 * searching a name-ish corpus for a *topic* finds nothing, because names are
 * not topics. No blog is called "Mercedes"; plenty of blogs write about
 * Mercedes constantly, and the only evidence for that is the posts.
 *
 * So there is ONE index and it is over posts. Feeds and collections are
 * aggregations over the posts that matched — not a separate feed search sitting
 * beside a post search. A feed is found *because* its posts matched, and ranked
 * by how much of what it publishes is about the thing you asked for.
 *
 * Everything the ranking is made of comes back in the payload (matches, total
 * posts, last match) so the UI can say it in words. A score nobody can see is a
 * magic ranking, and that is the thing thicket does not do.
 */
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { allowsSql } from "../lib/visibility.js";

export const search = new Hono();

export type Scope = "all" | "feeds" | "collections" | "posts" | "people";
const SCOPES: Scope[] = ["all", "feeds", "collections", "posts", "people"];

/**
 * How many post matches the aggregations look at. A query matching 100,000
 * posts ranks the most recent few thousand rather than scanning them all: an
 * approximation, but a bounded one, and it is what keeps search cheap as the
 * corpus grows. Invisible below the cap; biased toward the current conversation
 * above it, which is the right direction to be wrong in.
 */
const HIT_CAP = 4000;

/** What "Everything" shows of each kind before you narrow the scope. */
const PREVIEW = { feeds: 5, collections: 3, posts: 6, people: 3 } as const;

/**
 * Snippets come back with the matched words fenced by two control characters
 * rather than <mark> tags, so the browser splits on them and renders the
 * highlight itself. Post text is publisher HTML; it never reaches the DOM as
 * markup.
 */
const MARK_OPEN = "\u0001";
const MARK_CLOSE = "\u0002";
const HL = `StartSel=${MARK_OPEN}, StopSel=${MARK_CLOSE}, MaxWords=32, MinWords=14, ShortWord=3, MaxFragments=1`;

/**
 * Trigram similarity, floored. Below this, a "match" is an accident of shared
 * letters rather than a misspelling of the query — word_similarity scores
 * "mercedes" against "UX Collective - Medium" at 0.22, which is enough to push
 * a random feed above a relevant one once it is used as a ranking bonus.
 */
const FUZZY_FLOOR = 0.6;
const fuzzy = (q: string, col: string) => {
  const c = sql.raw(col);
  return sql`(case when word_similarity(${q}, ${c}) >= ${FUZZY_FLOOR} then word_similarity(${q}, ${c}) else 0 end)::real`;
};

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const likeFor = (q: string) => `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;

/**
 * The bounded sample of matching posts that every aggregation is built on, each
 * tagged with *where* in the post the match landed: 1 = title, 2 = summary,
 * 3 = body only. ts_filter reads the weights already stored in the tsvector, so
 * this costs no re-tokenizing and only the sampled rows are touched.
 */
const hits = (q: string) => sql`
  hits as (
    select i.feed_id, i.id, i.published_at,
           case
             when ts_filter(i.search, '{a}') @@ websearch_to_tsquery('english', ${q}) then 1
             when ts_filter(i.search, '{b}') @@ websearch_to_tsquery('english', ${q}) then 2
             else 3
           end as w
    from items i
    where i.search @@ websearch_to_tsquery('english', ${q})
    order by i.published_at desc
    limit ${HIT_CAP}
  )`;

/**
 * How many posts' worth of evidence a feed's matches are actually worth.
 *
 * Counting matches alone put three podcasts at the top of a search for
 * "privacy", every single episode matching, because their feeds append "See
 * Privacy Policy at art19.com" to the body of every episode. Boilerplate is the
 * failure mode of density ranking, and it has a tell: it appears outside the
 * title in essentially everything the feed publishes. A term in every post
 * carries no information about any post, so hits outside the title are
 * discounted by how common they are across the feed, squared — which takes
 * 583-of-583 privacy-policy footers to nothing and leaves a feed that mentions
 * the thing in a quarter of its posts almost untouched.
 *
 * Title hits are never discounted, and that asymmetry is the whole point: a blog
 * whose titles all say "Mercedes" is a blog about Mercedes. Applying the same
 * "it's in everything, so it means nothing" rule there would delete exactly the
 * focused small feeds this is built to surface — and nobody boilerplates a
 * title, which is what makes it the one field worth trusting at face value.
 */
const EVIDENCE = sql`(
  t_hits
  + (s_hits * 0.6 + b_hits * 0.4)
    * power(1 - least((s_hits + b_hits) / greatest(posts, 1), 1), 2)
)`;

/**
 * hits → per-feed tallies → per-feed evidence. Both the feed and the collection
 * query start here; a collection's evidence is the sum of its feeds', which is
 * why the discount has to be applied per feed before anything is added up.
 */
const feedEvidence = (q: string) => sql`
  ${hits(q)}
  , agg as (
    select feed_id, count(*)::int as matches, max(published_at) as last_match,
           count(*) filter (where w = 1)::numeric as t_hits,
           count(*) filter (where w = 2)::numeric as s_hits,
           count(*) filter (where w = 3)::numeric as b_hits
    from hits group by feed_id
  )
  , feedw as (
    select x.*, ${EVIDENCE} as weight from (
      select a.*, (select count(*)::numeric from items i2 where i2.feed_id = a.feed_id) as posts
      from agg a
    ) x
  )`;

/**
 * Feeds, ranked by density. ln(1 + matches) says "there is enough here to be
 * real" without letting 400 matches beat 40 by ten times; the smoothed share
 * says "and it is a lot of what they do", with the +25 stopping a three-post
 * blog with one hit from topping the list. A recency nudge worth up to a third
 * keeps a live conversation above an identical dead one.
 *
 * The name is the other half, and it is evidence in its own right — the
 * official "Mercedes-AMG PETRONAS F1 Team" channel is a perfect answer to
 * *mercedes* whether or not its video descriptions ever say the word. So the
 * name both multiplies whatever post evidence exists and carries a floor of its
 * own, which is what lets a feed with a matching name and no matching posts
 * place among the results instead of below all of them.
 */
async function searchFeeds(q: string, userId: number, limit: number, offset: number) {
  const like = likeFor(q);
  const named = sql`coalesce((f.title ilike ${like} or f.description ilike ${like} or f.url ilike ${like} or f.site_url ilike ${like} or ${q} <% coalesce(f.title, '')), false)`;
  /** 0 to 1. The title is worth most; a description or URL hit is weaker evidence. */
  const strength = sql`greatest(
    ${fuzzy(q, "coalesce(f.title, '')")},
    (case when f.title ilike ${like} then 0.85 else 0 end)::real,
    (case when f.description ilike ${like} then 0.35 else 0 end)::real,
    (case when f.url ilike ${like} or f.site_url ilike ${like} then 0.3 else 0 end)::real)`;
  const base = sql`
    with ${feedEvidence(q)}
    , cand as (
      select f.id, coalesce(a.matches, 0) as matches, coalesce(a.weight, 0) as weight, a.last_match,
             coalesce(a.posts, (select count(*)::numeric from items i2 where i2.feed_id = f.id)) as posts,
             ${named} as name_match,
             ${strength} as name_score
      from feeds f left join feedw a on a.feed_id = f.id
      where a.feed_id is not null or ${named}
    )
    , scored as (
      select *,
        case when matches = 0 then 0 else
          ln(1 + weight)
          * ((weight + 1.0) / (posts + 25))
          * (1 + 0.35 / (1 + extract(epoch from (now() - last_match)) / 2592000))
        end * (1 + 2 * name_score) + 0.35 * name_score as score
      from cand
    )`;
  const [{ total }] = (await db.execute<{ total: number }>(sql`${base} select count(*)::int as total from scored`)).rows;
  const rows = await db.execute(sql`
    ${base}
    select s.matches, s.posts::int as posts, s.last_match as "lastMatchAt", s.name_match as "nameMatch",
           f.id, f.url, f.site_url as "siteUrl", f.title, f.description,
           (select fs.display_name from feed_settings fs where fs.user_id = ${userId} and fs.feed_id = f.id) as "displayName",
           coalesce(
             nullif(left(trim(both '-' from regexp_replace(lower(f.title), '[^a-z0-9]+', '-', 'g')), 60), ''),
             nullif(trim(both '-' from regexp_replace(lower(split_part(coalesce(f.site_url, f.url), '/', 3)), '[^a-z0-9]+', '-', 'g')), ''),
             'feed'
           ) as slug,
           f.last_item_at as "lastItemAt", f.consecutive_failures as "consecutiveFailures",
           (select count(*)::int from items i where i.feed_id = f.id and i.published_at > now() - interval '30 days') as "postsLast30d",
           exists(select 1 from feed_icons fi where fi.feed_id = f.id and not fi.generic) as "hasIcon",
           coalesce((select array_agg(cf.collection_id order by cf.collection_id) from collection_feeds cf join collections col on col.id = cf.collection_id and col.user_id = ${userId} where cf.feed_id = f.id), '{}') as "myCollectionIds"
    from scored s join feeds f on f.id = s.id
    order by s.score desc, s.name_score desc nulls last, s.posts desc, f.id
    limit ${limit + 1} offset ${offset}
  `);
  const page = rows.rows.slice(0, limit).map((r: any) => ({ ...r, id: Number(r.id), lastMatchAt: iso(r.lastMatchAt), lastItemAt: iso(r.lastItemAt) }));
  return { rows: page, total, nextOffset: rows.rows.length > limit ? offset + limit : null };
}

/**
 * Collections. The same idea one level up: a collection is worth showing when
 * the feeds inside it are posting about the thing. The share is over *feeds*
 * rather than posts, because "4 of its 12 feeds write about this" is both
 * cheaper to compute and the sentence a person would actually say.
 *
 * Visibility is the viewer's, not the public one: search knows who is asking,
 * so a friends-only collection shows to a friend. Only a *feed document*, which
 * has no reader, is restricted to what is public to everyone.
 */
async function searchCollections(q: string, viewerId: number | null, limit: number, offset: number) {
  const like = likeFor(q);
  const me = viewerId ?? -1;
  const named = sql`coalesce((col.name ilike ${like} or col.description ilike ${like} or ${q} <% col.name), false)`;
  const strength = sql`greatest(
    ${fuzzy(q, "col.name")},
    (case when col.name ilike ${like} then 0.85 else 0 end)::real,
    (case when col.description ilike ${like} then 0.35 else 0 end)::real)`;
  const readable = sql`col.parent_id is not null and (col.user_id = ${me} or (
    u.profile_visibility = 'public' and ${allowsSql("col.visibility", "col.user_id", viewerId)} and ${allowsSql("u.collections_visibility", "u.id", viewerId)}))`;
  const base = sql`
    with ${feedEvidence(q)}
    , cand as (
      select col.id, col.name, col.slug, col.description, col.user_id,
             u.handle, u.display_name as "displayName",
             (select count(*)::int from collection_feeds cf where cf.collection_id = col.id) as "feedCount",
             coalesce((select sum(a.matches)::int from collection_feeds cf join feedw a on a.feed_id = cf.feed_id where cf.collection_id = col.id), 0) as matches,
             coalesce((select sum(a.weight) from collection_feeds cf join feedw a on a.feed_id = cf.feed_id where cf.collection_id = col.id), 0) as weight,
             coalesce((select count(*)::int from collection_feeds cf join feedw a on a.feed_id = cf.feed_id where cf.collection_id = col.id), 0) as "matchingFeeds",
             (select max(a.last_match) from collection_feeds cf join feedw a on a.feed_id = cf.feed_id where cf.collection_id = col.id) as last_match,
             ${named} as name_match,
             ${strength} as name_score
      from collections col join users u on u.id = col.user_id
      where ${readable} and (${named} or exists(
        select 1 from collection_feeds cf join feedw a on a.feed_id = cf.feed_id where cf.collection_id = col.id))
    )
    , scored as (
      select *,
        case when matches = 0 then 0 else
          ln(1 + weight) * (("matchingFeeds" + 1.0) / ("feedCount" + 3))
        end * (1 + 2 * name_score) + 0.35 * name_score as score
      from cand
    )`;
  const [{ total }] = (await db.execute<{ total: number }>(sql`${base} select count(*)::int as total from scored`)).rows;
  const rows = await db.execute(sql`
    ${base}
    select s.id, s.name, s.slug, s.description, s.handle, s."displayName", s."feedCount",
           s.matches, s."matchingFeeds", s.last_match as "lastMatchAt", s.name_match as "nameMatch",
           s.user_id = ${me} as "isMine",
           (select coalesce(json_agg(x), '[]'::json) from (
              select f.id, coalesce(cf.title_override, f.title) as title,
                     exists(select 1 from feed_icons fi where fi.feed_id = f.id and not fi.generic) as "hasIcon"
              from collection_feeds cf join feeds f on f.id = cf.feed_id
              where cf.collection_id = s.id order by f.last_item_at desc nulls last limit 4) x) as sample
    from scored s
    order by s.score desc, s.name_score desc nulls last, s."feedCount" desc, s.id
    limit ${limit + 1} offset ${offset}
  `);
  const page = rows.rows.slice(0, limit).map((r: any) => ({ ...r, id: Number(r.id), lastMatchAt: iso(r.lastMatchAt) }));
  return { rows: page, total, nextOffset: rows.rows.length > limit ? offset + limit : null };
}

/**
 * Posts: relevance with a recency tilt, not recency alone. Sorting "San
 * Antonio" purely by date hands you whoever used the phrase most recently — a
 * wire story that named the city once this morning outranking a decade of KSAT.
 */
async function searchPosts(q: string, viewerId: number | null, limit: number, offset: number) {
  const me = viewerId ?? -1;
  const base = sql`
    with ${hits(q)}
    , ranked as (
      select h.id, h.published_at,
             ts_rank(i.search, websearch_to_tsquery('english', ${q}))
               * (1 + 1.0 / (1 + extract(epoch from (now() - h.published_at)) / 2592000)) as score
      from hits h join items i on i.id = h.id
    )`;
  const [{ total }] = (await db.execute<{ total: number }>(sql`${base} select count(*)::int as total from ranked`)).rows;
  const rows = await db.execute(sql`
    ${base}
    select i.id, i.feed_id as "feedId", coalesce((select fs.display_name from feed_settings fs where fs.user_id = ${me} and fs.feed_id = i.feed_id), f.title) as "feedTitle", f.site_url as "siteUrl",
           i.url, i.title, i.author, i.image_url as "imageUrl", i.published_at as "publishedAt",
           ts_headline('english', regexp_replace(coalesce(nullif(i.summary, ''), left(coalesce(i.content, ''), 4000), ''), '<[^>]*>', ' ', 'g'),
                       websearch_to_tsquery('english', ${q}), ${HL}) as snippet,
           exists(select 1 from feed_icons fi where fi.feed_id = i.feed_id and not fi.generic) as "hasIcon",
           (select bm.id from bookmarks bm where bm.user_id = ${me} and bm.item_id = i.id limit 1) as "bookmarkId",
           coalesce((select array_agg(cf.collection_id order by cf.collection_id) from collection_feeds cf join collections col on col.id = cf.collection_id and col.user_id = ${me} where cf.feed_id = i.feed_id), '{}') as "myCollectionIds"
    from ranked r join items i on i.id = r.id join feeds f on f.id = i.feed_id
    where not exists(select 1 from blocks b where b.user_id = ${me} and b.feed_id = i.feed_id)
    order by r.score desc, r.published_at desc, i.id desc
    limit ${limit + 1} offset ${offset}
  `);
  const page = rows.rows.slice(0, limit).map((r: any) => ({ ...r, id: Number(r.id), feedId: Number(r.feedId), publishedAt: iso(r.publishedAt) }));
  return { rows: page, total, nextOffset: rows.rows.length > limit ? offset + limit : null };
}

/**
 * People, ranked on what they have written as well as what they are called.
 * Someone with six notes about a thing is a better answer than someone who put
 * the word in their bio — and the audience rules still hold, so a private note
 * never ranks anybody. Signed-in only: this is for following, which is the same
 * rule the Explore users list already carried.
 */
async function searchPeople(q: string, viewerId: number | null, limit: number, offset: number) {
  if (!viewerId) return { rows: [] as any[], total: 0, nextOffset: null as number | null };
  const like = likeFor(q);
  const named = sql`coalesce((u.handle ilike ${like} or u.display_name ilike ${like} or u.bio ilike ${like} or ${q} <% u.handle), false)`;
  const notesSeen = sql`(select count(*)::int from notes n where n.user_id = u.id and n.body ilike ${like}
    and ${allowsSql("u.notes_visibility", "u.id", viewerId)})`;
  const marksSeen = sql`(select count(*)::int from bookmarks bm where bm.user_id = u.id
    and (bm.title ilike ${like} or bm.summary ilike ${like} or bm.note ilike ${like})
    and ${allowsSql("u.bookmarks_visibility", "u.id", viewerId)})`;
  const base = sql`
    with cand as (
      select u.id, u.handle, u.display_name as "displayName", u.bio,
             greatest(
               ${fuzzy(q, "u.handle")},
               (case when u.handle ilike ${like} or u.display_name ilike ${like} then 0.85 else 0 end)::real,
               (case when u.bio ilike ${like} then 0.35 else 0 end)::real) as name_score,
             ${named} as name_match,
             ${notesSeen} as notes_match, ${marksSeen} as marks_match
      from users u
      where u.profile_visibility = 'public' and u.id <> ${viewerId}
        and (${named} or ${notesSeen} > 0 or ${marksSeen} > 0)
    )`;
  const [{ total }] = (await db.execute<{ total: number }>(sql`${base} select count(*)::int as total from cand`)).rows;
  const rows = await db.execute(sql`
    ${base}
    select c.handle, c."displayName", c.bio, c.name_match as "nameMatch",
           c.notes_match as "notesMatch", c.marks_match as "marksMatch",
           (select count(distinct cf.feed_id)::int from collection_feeds cf join collections col on col.id = cf.collection_id where col.user_id = c.id) as feeds,
           (select count(*)::int from collections col where col.user_id = c.id and col.parent_id is not null and col.visibility = 'public') as collections,
           exists(select 1 from user_follows uf where uf.follower_id = ${viewerId} and uf.followee_id = c.id) as "isFollowing"
    from cand c
    order by c.name_score + 0.4 * ln(1 + c.notes_match + c.marks_match) desc,
             (c.notes_match + c.marks_match) desc, lower(coalesce(c."displayName", c.handle))
    limit ${limit + 1} offset ${offset}
  `);
  return { rows: rows.rows.slice(0, limit), total, nextOffset: rows.rows.length > limit ? offset + limit : null };
}

const EMPTY = { rows: [] as any[], total: 0, nextOffset: null as number | null };

search.get("/", async (c) => {
  const viewer = c.get("user");
  const viewerId = viewer?.id ?? null;
  const q = (c.req.query("q") ?? "").trim();
  const asked = c.req.query("scope") as Scope | undefined;
  const scope: Scope = asked && SCOPES.includes(asked) ? asked : "all";
  const limit = Math.min(50, Math.max(1, Number(c.req.query("limit") ?? 25)));
  const offset = Math.max(0, Number(c.req.query("offset") ?? 0));
  if (!q) return c.json({ q, scope, feeds: EMPTY, collections: EMPTY, posts: EMPTY, people: EMPTY });

  /**
   * Every scope reports every total, so the scope chips can say how much sits
   * behind each of them without a second round trip. A kind the caller did not
   * ask for still runs — it has to, to produce the count — but for one row, and
   * its rows are dropped before the response is built.
   */
  const want = (kind: Scope) => scope === "all" || scope === kind;
  const take = (kind: keyof typeof PREVIEW) => (!want(kind) ? 1 : scope === "all" ? PREVIEW[kind] : limit);
  const from = (kind: Scope) => (want(kind) && scope !== "all" ? offset : 0);
  const [feeds, collections, posts, people] = await Promise.all([
    searchFeeds(q, viewerId ?? -1, take("feeds"), from("feeds")),
    searchCollections(q, viewerId, take("collections"), from("collections")),
    searchPosts(q, viewerId, take("posts"), from("posts")),
    searchPeople(q, viewerId, take("people"), from("people")),
  ]);
  const trim = (r: { rows: any[]; total: number; nextOffset: number | null }, kind: Scope) =>
    want(kind) ? r : { rows: [], total: r.total, nextOffset: null };
  // The answer depends on who is asking; a shared cache must key on the cookie.
  c.header("vary", "cookie");
  return c.json({
    q, scope,
    feeds: trim(feeds, "feeds"),
    collections: trim(collections, "collections"),
    posts: trim(posts, "posts"),
    people: trim(people, "people"),
  });
});
