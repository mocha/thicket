-- Every followed feed lives in a named collection. The root row (parent_id is
-- null) goes back to being nothing but the tree's parent: it is never shown,
-- never reachable by URL, and never holds feeds. "Unsorted" is gone.
--
-- A. A destination for whatever sits in a root today. Someone who had no
--    collections gets the same first collection a new account gets; someone who
--    already sorted most of their reading gets a plain bucket beside it.
with roots as (
  select root.id as root_id, root.user_id,
         exists (select 1 from collections c where c.user_id = root.user_id and c.parent_id is not null) as has_named
  from collections root
  where root.parent_id is null
    and exists (select 1 from collection_feeds cf where cf.collection_id = root.id)
)
insert into collections (user_id, parent_id, name, slug)
select user_id, root_id,
       case when has_named then 'Everything else' else 'My first collection' end,
       case when has_named then 'everything-else' else 'my-first-collection' end
from roots
on conflict do nothing;
--> statement-breakpoint

-- B. Move the memberships, then drop the root ones.
insert into collection_feeds (collection_id, feed_id)
select dest.id, cf.feed_id
from collection_feeds cf
join collections root on root.id = cf.collection_id and root.parent_id is null
join lateral (
  select c.id from collections c
  where c.user_id = root.user_id and c.parent_id is not null
  order by (c.slug in ('everything-else', 'my-first-collection')) desc, c.id
  limit 1
) dest on true
on conflict do nothing;
--> statement-breakpoint

delete from collection_feeds cf
using collections root
where cf.collection_id = root.id and root.parent_id is null;
--> statement-breakpoint

-- C. Nobody is left without somewhere to put a feed.
insert into collections (user_id, parent_id, name, slug)
select root.user_id, root.id, 'My first collection', 'my-first-collection'
from collections root
where root.parent_id is null
  and not exists (select 1 from collections c where c.user_id = root.user_id and c.parent_id is not null)
on conflict do nothing;
--> statement-breakpoint

-- D. The root's own name and slug stop saying "Unsorted"; nothing renders them.
update collections set name = 'All collections', slug = 'all-collections'
where parent_id is null and slug = 'unsorted';
