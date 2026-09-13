-- One address per collection. Slugs were unique per (user, parent), so a "News"
-- nested under "Tech" and a top-level "News" could both exist while only the
-- shallower one had a working URL — /@me/collections/news resolved to one of
-- them and the other was unreachable. Now unique per user.

-- 1. The root row's slug must be something nobody can type, so a person naming
--    a collection "All collections" never collides with the invisible root.
--    slugify() collapses runs of non-alphanumerics to a single dash and trims
--    the ends, so a leading double dash is unreachable by any name.
update collections set slug = '--root' where parent_id is null;
--> statement-breakpoint

-- 2. Break existing duplicates. Keeping the oldest, the rest take a suffix that
--    slugify can likewise never produce, so this can neither collide with a
--    slug someone chose nor with another renamed row (ids are unique).
--    The owner can rename them to something nicer; nothing links here.
with dups as (
  select id, slug, row_number() over (partition by user_id, slug order by id) as n
  from collections
)
update collections c set slug = c.slug || '--' || c.id
from dups d
where d.id = c.id and d.n > 1;
--> statement-breakpoint

drop index if exists collections_user_parent_slug_uq;
--> statement-breakpoint

create unique index collections_user_slug_uq on collections (user_id, slug);
