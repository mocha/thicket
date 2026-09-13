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
