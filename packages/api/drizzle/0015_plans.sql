-- Plans. An account has a plan (what it may do, lib/plans.ts) and a source for
-- it: the instance default, an admin's grant (until a date, or not), or a
-- subscription. Every existing account starts on `instance`, so nothing changes
-- for anyone until an admin sets the instance default or grants plans; a
-- self-hosted instance whose default stays `advanced` never notices this
-- migration at all.
--
-- email is a billing contact only: filled in when someone subscribes, never
-- used to sign in, never required of a free account (decided 2026-09-20).
create type plan as enum ('free', 'basic', 'advanced');
create type plan_source as enum ('instance', 'comp', 'stripe');

alter table users
  add column plan plan not null default 'free',
  add column plan_source plan_source not null default 'instance',
  add column plan_until timestamptz,
  add column email text;
