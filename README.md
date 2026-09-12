# thicket

A feed reader for the rewilded web. **Early — running, in use, and changing
weekly.** Expect rough edges and occasional breaking changes before 1.0.

You follow the sites you like; thicket shows you what they published, newest
first. It is a reader, not a network, and the difference is the point:

- **The order is the timestamp, and nothing else.** A ranked feed quietly hides
  how often a company posts, because repetition scores badly. In date order you
  see it the moment it starts, and you can unfollow.
- **Nothing is trying to keep you here.** No recommendations, no engineered
  notifications, no infinite anything. You reach the end of the day and stop.
- **What you read is nobody's business.** No tracking of what you open, no
  profile built about you, nothing kept that you did not ask us to save.
- **Leaving is a copy, not a loss.** Collections copy from any instance to any
  other, and an instance is one small server you can run yourself.

It speaks RSS, Atom and JSON Feed, finds a feed from any page address you
paste, and understands YouTube and Reddit URLs directly. Collections are
public by default and copy from one instance to another, so a reading list is
something you can hand to someone rather than a thing locked in an account.

## Run an instance

One container plus Postgres. See [docs/DEPLOY.md](docs/DEPLOY.md) for Compose,
reverse proxies, Railway, Supabase and Fly.

```sh
cp .env.example .env    # set PUBLIC_URL and POSTGRES_PASSWORD
docker compose up -d
```

The first account to sign up is the admin; sign-ups are invite-only after that.

## Develop

Requires Node 22, pnpm, and a Postgres client. `nix-shell` at the repo root
provides all three.

```sh
cp .env.example .env          # set DATABASE_URL
pnpm install
pnpm api                      # migrates the database on boot
pnpm seed 200                 # Ars Technica + 200 Small Web feeds
pnpm icons                    # fetch site icons for feeds not yet checked
pnpm web                      # http://localhost:5173  (proxies /api to the API)
```

Then open the web app and **Sign up**. Accounts are a handle and a password;
there is no email. After a schema change, `pnpm --filter @thicket/api db:generate`
writes a migration; it applies on the next boot. To reset someone's password
(or rename them) from the shell:

```sh
pnpm passwd <handle> <new password> [--rename <new handle>]
```

Sign-up policy is set by the admin in Settings; `SIGNUPS` in `.env` only seeds a fresh instance.

## Layout

```
packages/api   Hono + Drizzle + Postgres. Feed fetching, parsing, scheduling, HTTP API.
packages/web   SvelteKit PWA (Svelte 5 runes). Talks only to /api.
docs/DEPLOY.md Running an instance: Compose, reverse proxies, hosted platforms.
```

Two shapes are worth knowing before reading the code. **Feeds are global**:
one row per normalized URL, fetched once however many people follow it, so
"following" is derived from collection membership rather than a subscriptions
table. And **there is no read/unread state** — the river is chronological and
you scroll. Both are load-bearing; most of the data model follows from them.

## API

Plain JSON over a session cookie. Public reads (a profile, a public
collection, its river) work signed out.

**Accounts and sessions**

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/auth/status` | Instance name, address and sign-up policy; the sign-up page renders from it |
| POST | `/api/auth/signup` `{handle,password,displayName?,inviteCode?}` | Create an account; sets the session cookie |
| POST | `/api/auth/login` / `/api/auth/logout` | Session cookie in / out |
| GET / PATCH | `/api/auth/me` | The signed-in user and their settings (profile fields, visibility, whose notes to show, tracking opt-out) |
| POST | `/api/auth/me/password` `{current,next}` | Change password; signs out other devices |

**Reading**

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/river?before=&limit=&collection=&feed=` | Newest posts across followed feeds (or one collection, or one feed), keyset paginated. A public collection works signed out |
| GET | `/api/river/stats` | What you follow and what arrived in the last day |
| GET | `/api/feeds?q=&sort=&following=1\|0&offset=` | Instance index: every feed, with stats and my collection membership |
| GET | `/api/feeds/:id` | One feed with stats and my membership |
| GET | `/api/feeds/:id/icon` | Cached site icon, or 404 (the UI shows a monogram) |
| POST | `/api/feeds/:id/icon/refresh` | Re-run icon discovery now |
| POST | `/api/feeds/:id/refresh` | Fetch now; 429 with `retryAfterS` if fetched in the last 5 minutes |

**Following**

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/feeds` `{url}` | Follow any URL: page or feed. Returns `subscribed`, `choose` (several candidates), or `none` |
| POST | `/api/feeds/:id/follow` | Follow into Unsorted, or `{collectionId}` |
| DELETE | `/api/feeds/:id` | Unfollow; returns what was removed, for undo |
| POST | `/api/feeds/:id/restore` | Undo an unfollow |
| POST/DELETE | `/api/feeds/:id/block` | Block / unblock a feed (no UI yet) |

**Collections**

| Method | Path | Purpose |
|---|---|---|
| GET/POST | `/api/collections` | The collection tree / create one |
| GET/PATCH/DELETE | `/api/collections/:id` | One collection with its feeds and children |
| GET | `/api/collections/:id/orphans` | Feeds that would stop being followed if this collection went away |
| PUT/DELETE | `/api/collections/:id/feeds/:feedId` | Add / remove a feed |
| PUT | `/api/feeds/:id/collections` | Replace which collections hold a feed |
| GET | `/api/collections/:id/opml` | Export as OPML 2.0 (nested outlines = sub-collections) |
| POST | `/api/collections/:id/import` | Import an OPML document (raw body) into this collection |
| POST | `/api/collections/import-url` `{url}` | Copy a collection from any thicket, or any OPML URL, by link |

**People, and what they share**

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/profiles/:handle` | Public profile; respects profile, section and per-collection visibility |
| POST/DELETE | `/api/profiles/:handle/follow` | Follow / unfollow a person |
| GET | `/api/profiles/:handle/collections/:slug` | A public collection with its feeds; `/opml` gives the portable form |
| POST | `/api/profiles/:handle/collections/:slug/copy` | Copy it into my collections, as an independent copy |
| GET | `/api/profiles/:handle/bookmarks?before=` | Someone's public bookmarks, with whether I already have each |
| GET | `/api/explore/collections?q=&network=1` | Public collections on this instance |
| GET | `/api/explore/users?q=` | People with public profiles |
| GET | `/api/explore/featured` | The instance's starter packs: one account's public collections |

**Bookmarks and notes**

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/bookmarks?collection=&feed=&before=` | My bookmarks, newest saved first |
| GET | `/api/bookmarks/sources` | Feeds and collections present in my bookmarks, for filters |
| POST | `/api/bookmarks` `{itemId}` / `{bookmarkId}` / `{url}` | Save a post, copy someone's bookmark, or save a bare URL (idempotent per URL) |
| DELETE | `/api/bookmarks/:id` | Remove |
| GET | `/api/notes?before=` | My notes, newest first |
| GET | `/api/notes/count` | How many I have |
| PUT/DELETE | `/api/notes/items/:itemId` | Write, edit or delete my note on a post — one per person per post |

**Instance administration** (admins only)

| Method | Path | Purpose |
|---|---|---|
| GET/PATCH | `/api/admin/settings` | Instance name and sign-up policy |
| GET/POST | `/api/admin/invites` · DELETE `/api/admin/invites/:code` | Mint and revoke single-use invite links |
| GET | `/api/admin/users` · PATCH/DELETE `/api/admin/users/:id` | The accounts; promote, demote, remove |
| POST | `/api/admin/users/:id/password` | Issue a temporary password, shown once |
| GET/PUT | `/api/admin/starter` | Which account's collections newcomers are offered |

**Other**

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/events` | Product analytics, gated by `TRACK_ACTIVITY` and each user's opt-out |
| GET | `/api/health` | Scheduler stats, and what the proxy in front reported about the client |

## Contributing

Issues and pull requests are welcome. It is early enough that the most useful
thing you can file is what confused you: the shape of the product is still
moving, and a paragraph about what you expected to happen is worth more than
a patch.

## License

[GNU Affero General Public License v3.0](LICENSE). The network clause is the
point: if you run a modified thicket as a service, the people using it are
entitled to your changes. An instance you can leave is only meaningful if the
instance you leave for can exist.
