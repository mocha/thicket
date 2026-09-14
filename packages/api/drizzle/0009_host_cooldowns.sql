-- Sites that told thicket to back off, and until when (feeds/hosts.ts). ADDITIVE:
-- older code never reads it. Kept in the database so a redeploy in the middle
-- of a pause does not forget it.
create table if not exists host_cooldowns (
  host text primary key,
  until timestamptz not null,
  reason text,
  strikes integer not null default 0,
  outage_strikes integer not null default 0,
  updated_at timestamptz not null default now()
);
