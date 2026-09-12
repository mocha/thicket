-- Unsorted (the root collection) is exclusive with named collections from now on
-- (lib/subscribe.ts addFeedToCollection). Drop root memberships for feeds that a
-- named collection of the same user already holds.
delete from collection_feeds cf
using collections root
where cf.collection_id = root.id and root.parent_id is null
  and exists (
    select 1 from collection_feeds x join collections c on c.id = x.collection_id
    where c.user_id = root.user_id and c.parent_id is not null and x.feed_id = cf.feed_id
  );
