# Seeding an index

A new instance with an empty feed index has nothing to browse, and nothing to
browse is the same as nothing to join. `pnpm ingest <file>` fills it from a
plain list of feed URLs, one per line:

    pnpm ingest seeds/my-list.txt --concurrency 10

Every URL is normalized, inserted, and refreshed through the ordinary refresh
path, so a seeded feed is indistinguishable from one a person added — title,
description, icon and first items included. Anything that doesn't answer,
doesn't parse, has no items, or has been silent for longer than
`--max-age-days` (default 730) is removed again. An index full of rows with no
title, or of blogs that stopped in 2019, is worse than a smaller one.

## Where the 2026-09-13 seed came from

Two public lists, neither vendored here — they are large, they are maintained
upstream, and the sampler below reproduces the same selection from them.

**Small web — [Kagi Small Web](https://github.com/kagisearch/smallweb)**
(`smallweb.txt`, ~40,800 feed URLs). Independent and personal sites, actively
pruned upstream, which is why nearly all of a random sample is still alive.

**Big web — [awesome-rss-feeds](https://github.com/plenaryapp/awesome-rss-feeds)**
(`recommended/with_category/*.opml`, 41 topics). Recognizable publications,
sorted by subject, which is what makes an even slice per topic possible.

The ratio was deliberate: roughly **20% big web, 80% small web**. A daily
publication posting ten times a day is worth dozens of independent blogs by
volume, so an index that looks balanced by feed count reads as overwhelmingly
big-web in the river. Eighty percent small web is what it takes for the river
to feel like the open web rather than a news app.

## Reproducing the sample

`sample.mjs` takes the two upstream lists and writes the two candidate files,
using a fixed shuffle seed so the same run produces the same sample:

    curl -sL -o /tmp/smallweb.txt https://raw.githubusercontent.com/kagisearch/smallweb/main/smallweb.txt
    node seeds/sample.mjs /tmp/smallweb.txt /tmp/opml-dir

It takes at most two feeds per publisher from the big-web lists (a site's five
section feeds are five feeds, but they shouldn't eat the sample) and one per
site from the small-web list (that list is the long tail, not sections).

## What was cut on 2026-09-30

The big-web list comes from an Indian publisher, and it leaned on Indian
national news: Times of India, Economic Times, Indian Express, NDTV, and The
Hindu turned up across News, Sports, and Business, plus a whole Cricket topic.
Most early readers are in the US, so `sample.mjs` now leaves out the Cricket
topic and those five outlets. Other India-related feeds stay.

`dropped-2026-09-30.txt` lists the same feeds, for an index an earlier seed
already filled:

    pnpm drop-feeds seeds/dropped-2026-09-30.txt            # list what would go
    pnpm drop-feeds seeds/dropped-2026-09-30.txt --apply    # remove it

A feed someone follows, or has bookmarked a post from, is kept.

## Duplicates

A seed can bring in a feed the index already has under another address:
http and https, `/feed` and `/rss.xml`, with and without www. New feeds are
checked for this on their first refreshes and folded into the one already
there. For feeds that got in before that check existed:

    pnpm dedupe-feeds            # list the pairs, change nothing
    pnpm dedupe-feeds --apply    # fold them; follows, bookmarks, and notes move over

## The 2026-09-30 addition

For range beyond the first list, and because most early readers are in the US,
a second big-web slice comes from two more public lists:

**Kagi News sources — [kagisearch/kite-public](https://github.com/kagisearch/kite-public)**
(`core_feeds.py`, ~1,000 English feeds in 24 topics, maintained by Kagi, MIT).
Strong on US news, sports, business, science, and tech. Google News searches,
Reddit, and YouTube are left out, as are the Guns topic and a note about
sign-ins. The CC BY-NC license in that repo's readme covers Kagi News's app
data at kite.kagi.com, not this file.

**[Most Popular Blogs of Hacker News 2025](https://gist.github.com/emschwartz/e6d2bf860ccc367fe37ff953ba6de66b)**
(92 well-known, mostly US personal blogs). Recognizable names rather than range.

    curl -sL -o /tmp/core_feeds.py https://raw.githubusercontent.com/kagisearch/kite-public/main/core_feeds.py
    curl -sL -o /tmp/hn-blogs.opml https://gist.githubusercontent.com/emschwartz/e6d2bf860ccc367fe37ff953ba6de66b/raw/hn-popular-blogs-2025.opml
    node seeds/sample-us.mjs /tmp/core_feeds.py /tmp/hn-blogs.opml
    pnpm ingest cand-us.txt --concurrency 10

The same rules as the first sample: at most 20 per topic and two per
publisher, so about 350 candidates. In a 40-feed trial run, 33 were added.
