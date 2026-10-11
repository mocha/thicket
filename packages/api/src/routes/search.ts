/**
 * Search: one query box, over one kind of thing at a time.
 *
 * Each request searches the one scope asked for: feeds, collections, posts or
 * people. It used to run all four on every request, so each tab could show a
 * count, and that made one search eight queries holding four connections.
 * Measured on production 2026-10-11, a few people typing at once were enough to
 * starve every other page of connections. A scope's query is now one statement,
 * cancelled in Postgres when the browser abandons it (db/client.ts).
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
 * posts, last match), so the order can always be checked against what it was
 * built from. A score nobody can see is a magic ranking, and that is the thing
 * thicket does not do. Feed rows show a plainer fact beside it: how often the
 * feed mentions the words over the last 30 days, counted exactly per feed.
 */
import { Hono } from "hono";
import { sql, type SQL } from "drizzle-orm";
import { cancellable } from "../db/client.js";
import { allowsSql, notARepeatOf } from "../lib/visibility.js";
import { myBookmarkIdSql } from "../lib/notes.js";

export const search = new Hono();

export type Scope = "feeds" | "collections" | "posts" | "people";
export const SCOPES: Scope[] = ["feeds", "collections", "posts", "people"];
/**
 * Posts, when the caller doesn't say. "all" was the old everything-at-once
 * scope; links and scripts that still ask for it get posts, which is what that
 * page mostly showed.
 */
export const DEFAULT_SCOPE: Scope = "posts";
export const scopeFrom = (v: string | null | undefined): Scope =>
  (SCOPES as string[]).includes(v ?? "") ? (v as Scope) : DEFAULT_SCOPE;

/** Every query a request runs goes through its own cancellable connection. */
type Exec = (query: SQL) => Promise<{ rows: any[] }>;

/**
 * How many post matches the aggregations look at. A query matching 100,000
 * posts ranks the most recent few thousand rather than scanning them all: an
 * approximation, but a bounded one, and it is what keeps search cheap as the
 * corpus grows. Invisible below the cap; biased toward the current conversation
 * above it, which is the right direction to be wrong in.
 */
const HIT_CAP = 4000;

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
 * "People I follow", applied to a search. It is the same rule the browse lists
 * use: a feed is in your network when someone you follow keeps it in a
 * collection, and a collection is in your network when its owner is someone you
 * follow. The follow set is resolved once (direct follows only — the toggle
 * offers one level) and then reused by each scope as a plain predicate.
 *
 * `net` is null when the filter is off, and an id list when it is on — an empty
 * list means "on, but you follow no one", which is no results, exactly like
 * browse.
 */
async function followSet(x: Exec, viewerId: number | null): Promise<number[]> {
  if (!viewerId) return [];
  const rows = await x(
    sql`select followee_id as id from user_follows where follower_id = ${viewerId} and followee_id <> ${viewerId}`,
  );
  return rows.rows.map((r) => Number(r.id));
}
const idList = (ids: number[]) => sql.join(ids.map((id) => sql`${id}`), sql`, `);
/** A feed is in the network when someone you follow files it in a collection. */
const feedInNetwork = (feedIdCol: string, ids: number[]) =>
  ids.length
    ? sql`exists(select 1 from collection_feeds cf join collections col on col.id = cf.collection_id
        where cf.feed_id = ${sql.raw(feedIdCol)} and col.user_id in (${idList(ids)}))`
    : sql`false`;
/** A collection is in the network when its owner is someone you follow. */
const ownerInNetwork = (ids: number[]) => (ids.length ? sql`col.user_id in (${idList(ids)})` : sql`false`);

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
 *
 * `posts` is the feed's stored post count (feeds.item_count, kept by a
 * trigger). It used to be counted here, every matched feed's whole history on
 * every search, which was most of a search's cost after JIT and grew with
 * every post stored.
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
      select a.*, f.item_count::numeric as posts from agg a join feeds f on f.id = a.feed_id
    ) x
  )`;

/**
 * The orders a reader can put the feed results in (issue 182). Each is a fact
 * about the feed that can be checked, not a score: the newest post that
 * mentions the words, the newest post of any kind, how many posts mentioned the
 * words in the last 90 days, and how many posts there were in the last 90 days.
 *
 * "about" is the default because it is the nearest of the four to the
 * relevance order this list used to have. Changing the default is this one
 * line and its twin, DEFAULT_FEED_SORT in the web app's lib/api.ts.
 */
export const FEED_SORTS = ["mentioned", "posted", "about", "active"] as const;
export type FeedSort = (typeof FEED_SORTS)[number];
export const DEFAULT_FEED_SORT: FeedSort = "about";
/** Anything that isn't one of the four, including nothing, is the default. */
export const feedSortFrom = (v: string | null | undefined): FeedSort =>
  (FEED_SORTS as readonly string[]).includes(v ?? "") ? (v as FeedSort) : DEFAULT_FEED_SORT;

/**
 * Posts in the last 90 days that mention the words, per feed, and the 30-day
 * share of them. One pass over the matching posts, bounded by date: the text
 * index finds the matches and the date bound cuts them to the window, so no
 * feed's older history is read. Exact, not sampled: it isn't capped like hits.
 *
 * `n30` is what each row says ("about N a week"). It used to be counted per
 * row by walking the feed's last 30 days, which for a news feed meant reading
 * 400-odd posts' search vectors per row: 450 ms of a 950 ms search for "news".
 */
const recentMentions = (q: string) => sql`
  recent as (
    select i.feed_id, count(*)::int as n,
           count(*) filter (where i.published_at > now() - interval '30 days')::int as n30
    from items i
    where i.search @@ websearch_to_tsquery('english', ${q}) and i.published_at > now() - interval '90 days'
    group by i.feed_id
  )`;

/**
 * The value each order sorts on, worked out for every candidate feed (a sort
 * has to see them all). Each one is a bounded read:
 *  - mentioned: read off the sample, where it is exact (the sample is the
 *    newest hits, so a feed in it has its newest hit in it). A feed outside the
 *    sample has no mention newer than everything in it, so it belongs at the
 *    tail either way, where the score orders it instead of a lookup: for a
 *    feed found by name that never mentions the words, that lookup would
 *    read the feed's whole history.
 *  - posted: a column on the feed, kept current as posts arrive.
 *  - about: the date-bounded tally above, joined in.
 *  - active: the feed's stored 90-day count (feeds.posts_90d, recounted hourly
 *    by lib/counts.ts), rather than counting it for every candidate here.
 */
const SORT_KEY: Record<FeedSort, SQL> = {
  mentioned: sql`a.last_match`,
  posted: sql`f.last_item_at`,
  about: sql`coalesce(r.n, 0)`,
  active: sql`f.posts_90d`,
};

/**
 * How each order sorts, ahead of the relevance score that breaks ties.
 *
 * For the two orders about the words (mentioned, about), feeds that are here
 * only because their name or description matches come after every feed with a
 * post that mentions the words: they have no mention to be recent or many.
 * The two orders about the feed itself (posted, active) sort every feed
 * together, name matches included, since how much and how lately a feed posts
 * is true of it whatever its posts are about.
 */
const SORT_ORDER: Record<FeedSort, SQL> = {
  mentioned: sql`s.sort_key desc nulls last,`,
  posted: sql`s.sort_key desc nulls last,`,
  about: sql`s.sort_key desc, (s.matches > 0) desc,`,
  active: sql`s.sort_key desc,`,
};

/**
 * One page of a list, and how long the whole list is. Every query below
 * returns its total as `__total` on each row: a scalar count over the CTE the
 * rows are cut from, which Postgres computes once. (A window count would make
 * it build every row's display columns before the limit.) A page past the end
 * has no row to carry it, and can only be asked for by a stale link.
 */
function paged(rows: any[], limit: number, offset: number) {
  const total = rows.length ? Number(rows[0].__total) : offset;
  const page = rows.slice(0, limit).map(({ __total, ...r }) => r);
  return { page, total, nextOffset: rows.length > limit ? offset + limit : null };
}

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
 *
 * That score no longer orders the list on its own. A density order read as no
 * order at all to the people using it (issue 182), so the list is sorted by a
 * plain fact the reader picks (see FeedSort) and the score only breaks ties.
 */
async function searchFeeds(x: Exec, q: string, userId: number, limit: number, offset: number, net: number[] | null = null, sort: FeedSort = DEFAULT_FEED_SORT) {
  const like = likeFor(q);
  const named = sql`coalesce((f.title ilike ${like} or f.description ilike ${like} or f.url ilike ${like} or f.site_url ilike ${like} or ${q} <% coalesce(f.title, '')), false)`;
  /** 0 to 1. The title is worth most; a description or URL hit is weaker evidence. */
  const strength = sql`greatest(
    ${fuzzy(q, "coalesce(f.title, '')")},
    (case when f.title ilike ${like} then 0.85 else 0 end)::real,
    (case when f.description ilike ${like} then 0.35 else 0 end)::real,
    (case when f.url ilike ${like} or f.site_url ilike ${like} then 0.3 else 0 end)::real)`;
  const base = sql`
    with ${feedEvidence(q)}, ${recentMentions(q)}
    , cand as (
      select f.id, coalesce(a.matches, 0) as matches, coalesce(a.weight, 0) as weight, a.last_match,
             f.item_count::numeric as posts, coalesce(r.n30, 0) as n30,
             ${named} as name_match,
             ${strength} as name_score,
             ${SORT_KEY[sort]} as sort_key
      from feeds f left join feedw a on a.feed_id = f.id left join recent r on r.feed_id = f.id
      where (a.feed_id is not null or ${named})${net ? sql` and ${feedInNetwork("f.id", net)}` : sql``}
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
  const rows = await x(sql`
    ${base}
    select (select count(*)::int from scored) as __total,
           s.matches, s.posts::int as posts, s.name_match as "nameMatch",
           -- What the row says in words, counted exactly rather than read off the
           -- capped sample: the ranking can live with an approximation, but a
           -- number shown to a person has to be true. The 30-day count comes from
           -- the uncapped pass above; the latest mention walks this one feed's
           -- posts newest first and stops at the first, so it stays cheap.
           s.n30 as "matchesLast30d",
           (select i.published_at from items i where i.feed_id = f.id and i.search @@ websearch_to_tsquery('english', ${q})
              order by i.published_at desc limit 1) as "lastMatchAt",
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
    order by ${SORT_ORDER[sort]} s.score desc, s.name_score desc nulls last, s.posts desc, f.id
    limit ${limit + 1} offset ${offset}
  `);
  const { page, total, nextOffset } = paged(rows.rows, limit, offset);
  return { rows: page.map((r: any) => ({ ...r, id: Number(r.id), lastMatchAt: iso(r.lastMatchAt), lastItemAt: iso(r.lastItemAt) })), total, nextOffset };
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
async function searchCollections(x: Exec, q: string, viewerId: number | null, limit: number, offset: number, net: number[] | null = null) {
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
      select col.id, col.name, col.slug, col.description, col.user_id, col.copied_from_id,
             u.handle, u.display_name as "displayName",
             col.feed_count as "feedCount",
             coalesce((select sum(a.matches)::int from collection_feeds cf join feedw a on a.feed_id = cf.feed_id where cf.collection_id = col.id), 0) as matches,
             coalesce((select sum(a.weight) from collection_feeds cf join feedw a on a.feed_id = cf.feed_id where cf.collection_id = col.id), 0) as weight,
             coalesce((select count(*)::int from collection_feeds cf join feedw a on a.feed_id = cf.feed_id where cf.collection_id = col.id), 0) as "matchingFeeds",
             (select max(a.last_match) from collection_feeds cf join feedw a on a.feed_id = cf.feed_id where cf.collection_id = col.id) as last_match,
             ${named} as name_match,
             ${strength} as name_score
      from collections col join users u on u.id = col.user_id
      where ${readable} and (${named} or exists(
        select 1 from collection_feeds cf join feedw a on a.feed_id = cf.feed_id where cf.collection_id = col.id))${net ? sql` and ${ownerInNetwork(net)}` : sql``}
    )
    , scored as (
      select *,
        case when matches = 0 then 0 else
          ln(1 + weight) * (("matchingFeeds" + 1.0) / ("feedCount" + 3))
        end * (1 + 2 * name_score) + 0.35 * name_score as score
      from cand c
      -- Repeats are judged among what this search found, after every filter:
      -- a copy steps aside only for an original or earlier copy that is itself
      -- in the results. My own copy always shows beside the original.
      where c.user_id = ${me} or ${notARepeatOf("c", "cand")}
    )`;
  const rows = await x(sql`
    ${base}
    select (select count(*)::int from scored) as __total,
           s.id, s.name, s.slug, s.description, s.handle, s."displayName", s."feedCount",
           s.matches, s."matchingFeeds", s.last_match as "lastMatchAt", s.name_match as "nameMatch",
           s.user_id = ${me} as "isMine",
           exists(select 1 from collections mine where mine.user_id = ${me} and mine.copied_from_id = s.id) as "copiedByMe",
           (select coalesce(json_agg(x), '[]'::json) from (
              select f.id, coalesce(cf.title_override, f.title) as title,
                     exists(select 1 from feed_icons fi where fi.feed_id = f.id and not fi.generic) as "hasIcon"
              from collection_feeds cf join feeds f on f.id = cf.feed_id
              where cf.collection_id = s.id order by f.last_item_at desc nulls last limit 4) x) as sample
    from scored s
    order by s.score desc, s.name_score desc nulls last, s."feedCount" desc, s.id
    limit ${limit + 1} offset ${offset}
  `);
  const { page, total, nextOffset } = paged(rows.rows, limit, offset);
  return { rows: page.map((r: any) => ({ ...r, id: Number(r.id), lastMatchAt: iso(r.lastMatchAt) })), total, nextOffset };
}

/**
 * The orders a Posts list can take. Newest first is the default: it is the
 * plainest fact about a post, it is what a reader landing on Explore expects of
 * "the latest", and it is the cheaper of the two, needing no score per match.
 *
 * "relevance" keeps the old order, relevance with a recency tilt, for when the
 * words matter more than the date. Sorting "San Antonio" purely by date hands
 * you whoever used the phrase most recently, a wire story that named the city
 * once this morning ahead of a decade of KSAT, and that is the case it is for.
 */
export const POST_SORTS = ["newest", "relevance"] as const;
export type PostSort = (typeof POST_SORTS)[number];
export const DEFAULT_POST_SORT: PostSort = "newest";
export const postSortFrom = (v: string | null | undefined): PostSort =>
  (POST_SORTS as readonly string[]).includes(v ?? "") ? (v as PostSort) : DEFAULT_POST_SORT;

/** What a post row shows, given `i` (items) and `f` (feeds) joined in. */
const postColumns = (me: number, q: string | null) => sql`
  i.id, i.feed_id as "feedId", coalesce((select fs.display_name from feed_settings fs where fs.user_id = ${me} and fs.feed_id = i.feed_id), f.title) as "feedTitle", f.site_url as "siteUrl",
  i.url, i.title, i.author, i.image_url as "imageUrl", i.published_at as "publishedAt",
  ${q
    ? sql`ts_headline('english', regexp_replace(coalesce(nullif(i.summary, ''), left(coalesce(i.content, ''), 4000), ''), '<[^>]*>', ' ', 'g'),
                       websearch_to_tsquery('english', ${q}), ${HL})`
    : sql`left(i.summary, 400)`} as snippet,
  exists(select 1 from feed_icons fi where fi.feed_id = i.feed_id and not fi.generic) as "hasIcon",
  ${myBookmarkIdSql(me)} as "bookmarkId",
  coalesce((select array_agg(cf.collection_id order by cf.collection_id) from collection_feeds cf join collections col on col.id = cf.collection_id and col.user_id = ${me} where cf.feed_id = i.feed_id), '{}') as "myCollectionIds"`;

const notBlocked = (me: number) => sql`not exists(select 1 from blocks b where b.user_id = ${me} and b.feed_id = i.feed_id)`;

const shapePost = (r: any) => ({ ...r, id: Number(r.id), feedId: Number(r.feedId), publishedAt: iso(r.publishedAt) });

/**
 * Posts that mention the words. Both orders read the same bounded sample (the
 * newest HIT_CAP matches), so the total is "4,000" at most for a common word:
 * the same honest cap the feed ranking has always used.
 */
async function searchPosts(x: Exec, q: string, viewerId: number | null, limit: number, offset: number, net: number[] | null, sort: PostSort) {
  const me = viewerId ?? -1;
  const matched = sql`
    matched as materialized (
      select i.id, i.published_at from items i
      where i.search @@ websearch_to_tsquery('english', ${q}) and ${notBlocked(me)}
        ${net ? sql`and ${feedInNetwork("i.feed_id", net)}` : sql``}
      order by i.published_at desc, i.id desc
      limit ${HIT_CAP}
    )`;
  // The page is cut from `matched` before any display column is built, so
  // snippets and lookups run for one page of rows, not for every match.
  const pageOf = sort === "newest"
    ? sql`select m.id, m.published_at, 0::real as score from matched m order by m.published_at desc, m.id desc limit ${limit + 1} offset ${offset}`
    : sql`select m.id, m.published_at,
                 ts_rank(i.search, websearch_to_tsquery('english', ${q}))
                   * (1 + 1.0 / (1 + extract(epoch from (now() - m.published_at)) / 2592000)) as score
          from matched m join items i on i.id = m.id
          order by score desc, m.published_at desc, m.id desc limit ${limit + 1} offset ${offset}`;
  const rows = await x(sql`
    with ${matched}, pg as (${pageOf})
    select (select count(*)::int from matched) as __total, ${postColumns(me, q)}
    from pg join items i on i.id = pg.id join feeds f on f.id = i.feed_id
    order by pg.score desc, pg.published_at desc, pg.id desc
  `);
  const { page, total, nextOffset } = paged(rows.rows, limit, offset);
  return { rows: page.map(shapePost), total, nextOffset };
}

/**
 * The newest posts on the instance, for Posts with nothing typed: what Explore
 * opens on. One walk down items_published_idx, stopping at the page, so it
 * costs the same however many posts are stored. No total: counting every post
 * to print one number would be the one expensive part.
 *
 * "People I follow" can't take that walk: it would read past everyone else's
 * posts to find theirs, unbounded for someone whose network reads little. So it
 * merges each network feed's own newest page instead, the way the river does
 * (routes/river.ts), which costs one index descent per feed.
 */
async function latestPosts(x: Exec, viewerId: number | null, limit: number, offset: number, net: number[] | null) {
  const me = viewerId ?? -1;
  const want = limit + 1;
  const pageOf = net
    ? net.length
      ? sql`
        with nf as (select distinct cf.feed_id from collection_feeds cf join collections col on col.id = cf.collection_id
                    where col.user_id in (${idList(net)}))
        select p.id, p.published_at from nf cross join lateral (
          select i.id, i.published_at from items i
          where i.feed_id = nf.feed_id and i.published_at <= now() and ${notBlocked(me)}
          order by i.published_at desc, i.id desc limit ${offset + want}
        ) p
        order by p.published_at desc, p.id desc limit ${want} offset ${offset}`
      : sql`select null::bigint as id, null::timestamptz as published_at where false`
    : sql`
        select i.id, i.published_at from items i
        where i.published_at <= now() and ${notBlocked(me)}
        order by i.published_at desc, i.id desc limit ${want} offset ${offset}`;
  const rows = await x(sql`
    select ${postColumns(me, null)}
    from (${pageOf}) pg join items i on i.id = pg.id join feeds f on f.id = i.feed_id
    order by pg.published_at desc, pg.id desc
  `);
  return { rows: rows.rows.slice(0, limit).map(shapePost), total: null, nextOffset: rows.rows.length > limit ? offset + limit : null };
}

/**
 * People, ranked on what they have written as well as what they are called.
 * Someone with six notes about a thing is a better answer than someone who put
 * the word in their bio — and the audience rules still hold, so a private note
 * never ranks anybody. Signed-in only: this is for following, which is the same
 * rule the Explore users list already carried. Unlike that list, the viewer is
 * in it, marked `isMe`: someone searching their own name expects to be found,
 * and seeing themselves (or not, with a private profile) is how they check
 * what everyone else sees.
 */
async function searchPeople(x: Exec, q: string, viewerId: number | null, limit: number, offset: number) {
  if (!viewerId) return { rows: [] as any[], total: 0, nextOffset: null as number | null };
  const like = likeFor(q);
  const named = sql`coalesce((u.handle ilike ${like} or u.display_name ilike ${like} or u.bio ilike ${like} or ${q} <% u.handle), false)`;
  // A note is part of a bookmark, but it has its own audience: the note's text
  // counts when notes are shared with this viewer, the saved post's when
  // bookmarks are.
  const notesSeen = sql`(select count(*)::int from bookmarks n where n.user_id = u.id and n.note ilike ${like}
    and ${allowsSql("u.notes_visibility", "u.id", viewerId)})`;
  const marksSeen = sql`(select count(*)::int from bookmarks bm where bm.user_id = u.id
    and (bm.title ilike ${like} or bm.summary ilike ${like})
    and ${allowsSql("u.bookmarks_visibility", "u.id", viewerId)})`;
  const rows = await x(sql`
    with cand as materialized (
      select u.id, u.handle, u.display_name as "displayName", u.bio,
             greatest(
               ${fuzzy(q, "u.handle")},
               (case when u.handle ilike ${like} or u.display_name ilike ${like} then 0.85 else 0 end)::real,
               (case when u.bio ilike ${like} then 0.35 else 0 end)::real) as name_score,
             ${named} as name_match,
             ${notesSeen} as notes_match, ${marksSeen} as marks_match
      from users u
      where u.profile_visibility = 'public'
        and (${named} or ${notesSeen} > 0 or ${marksSeen} > 0)
    )
    select (select count(*)::int from cand) as __total,
           c.handle, c."displayName", c.bio, c.name_match as "nameMatch",
           c.notes_match as "notesMatch", c.marks_match as "marksMatch",
           (select ua.updated_at from user_avatars ua where ua.user_id = c.id) as "avatarUpdatedAt",
           (select count(distinct cf.feed_id)::int from collection_feeds cf join collections col on col.id = cf.collection_id where col.user_id = c.id) as feeds,
           (select count(*)::int from collections col where col.user_id = c.id and col.parent_id is not null and col.visibility = 'public') as collections,
           exists(select 1 from user_follows uf where uf.follower_id = ${viewerId} and uf.followee_id = c.id) as "isFollowing",
           c.id = ${viewerId} as "isMe"
    from cand c
    order by c.name_score + 0.4 * ln(1 + c.notes_match + c.marks_match) desc,
             (c.notes_match + c.marks_match) desc, lower(coalesce(c."displayName", c.handle))
    limit ${limit + 1} offset ${offset}
  `);
  const { page, total, nextOffset } = paged(rows.rows, limit, offset);
  return { rows: page, total, nextOffset };
}

/**
 * GET /api/search?q=&scope=&sort=&network=&offset=&limit=
 *
 * Answers with the one list asked for, under its scope's name, e.g.
 * `{ q, scope: "posts", sort, posts: { rows, total, nextOffset } }`.
 *
 * Posts with no words is the instance's newest posts (`total` null); any other
 * scope with no words is empty, since its browse list is its own endpoint
 * (/api/feeds, /api/explore/collections, /api/explore/users).
 *
 * If the browser gives up on the request (a new search, another tab), its query
 * is cancelled in Postgres rather than left to run (db/client.ts).
 */
search.get("/", async (c) => {
  const viewer = c.get("user");
  const viewerId = viewer?.id ?? null;
  const q = (c.req.query("q") ?? "").trim();
  const scope = scopeFrom(c.req.query("scope"));
  const limit = Math.min(50, Math.max(1, Number(c.req.query("limit") ?? 25)));
  const offset = Math.max(0, Number(c.req.query("offset") ?? 0));
  const sort = scope === "feeds" ? feedSortFrom(c.req.query("sort")) : scope === "posts" ? postSortFrom(c.req.query("sort")) : null;
  const network = c.req.query("network") === "1";

  const list = await cancellable(c.req.raw.signal, async (x) => {
    if (!q && scope !== "posts") return { rows: [] as any[], total: 0, nextOffset: null as number | null };
    // "People I follow": null = filter off; a (possibly empty) id list = filter on.
    const net = network ? await followSet(x, viewerId) : null;
    if (scope === "posts") return q ? searchPosts(x, q, viewerId, limit, offset, net, sort as PostSort) : latestPosts(x, viewerId, limit, offset, net);
    if (scope === "feeds") return searchFeeds(x, q, viewerId ?? -1, limit, offset, net, sort as FeedSort);
    if (scope === "collections") return searchCollections(x, q, viewerId, limit, offset, net);
    return searchPeople(x, q, viewerId, limit, offset);
  });
  // The answer depends on who is asking; a shared cache must key on the cookie.
  c.header("vary", "cookie");
  return c.json({ q, scope, sort, [scope]: list });
});
