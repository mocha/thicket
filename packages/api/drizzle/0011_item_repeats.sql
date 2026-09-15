-- Reposts: a post that repeats an earlier post from the same feed, recorded
-- against the earlier posts it repeats (feeds/repeats.ts has the rule and why).
-- Nothing is hidden by this; the post says so and the feed's stats count it.
--
-- ADDITIVE: one table and two indexes, which code on the previous revision
-- never reads. The title index is what makes matching a lookup instead of a
-- scan of the feed; its expression must stay byte-identical to titleKey() in
-- feeds/repeats.ts.
--
-- The last statement flags what the index already holds. On the dev copy
-- (~76,000 posts) it found 403 repeats in 85 feeds and took about a second.

create table if not exists item_repeats (
  item_id bigint not null references items(id) on delete cascade,
  of_item_id bigint not null references items(id) on delete cascade,
  primary key (item_id, of_item_id)
);
--> statement-breakpoint
create index if not exists item_repeats_of_idx on item_repeats (of_item_id);
--> statement-breakpoint
create index if not exists items_feed_titlekey_idx on items (feed_id, (lower(regexp_replace(title, '[^[:alnum:]]+', '', 'g'))));
--> statement-breakpoint
insert into item_repeats (item_id, of_item_id)
select n.id, o.id
from items n
cross join lateral (
  select o.id from items o
  where o.feed_id = n.feed_id
    and lower(regexp_replace(o.title, '[^[:alnum:]]+', '', 'g')) = lower(regexp_replace(n.title, '[^[:alnum:]]+', '', 'g'))
    and (o.published_at, o.id) < (n.published_at, n.id)
    and (o.url = n.url or coalesce(o.summary, '') = coalesce(n.summary, '') or similarity(left(o.summary, 300), left(n.summary, 300)) >= 0.6)
  order by o.published_at desc
  limit 5
) o
where n.title is not null and length(lower(regexp_replace(n.title, '[^[:alnum:]]+', '', 'g'))) >= 4
on conflict do nothing;
