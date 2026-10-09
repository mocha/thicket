# Deploying thicket

thicket is one container: the API serves the web app and runs the feed
fetcher. It needs a Postgres database and two settings, `DATABASE_URL` and
`PUBLIC_URL`. Migrations run on boot, so upgrading is pull and restart. The
first account created becomes the admin and sign-ups switch to invite-only.

## Small install: Docker Compose

```sh
git clone https://github.com/mocha/thicket.git && cd thicket   # or just grab compose.yml + .env.example
cp .env.example .env
$EDITOR .env          # set PUBLIC_URL and POSTGRES_PASSWORD
docker compose up -d
```

Open `PUBLIC_URL`, sign up, and you're the admin. Settings → This instance is
where you mint invite links or open sign-ups.

| Task | Command |
|---|---|
| Upgrade | `docker compose pull && docker compose up -d` |
| Backup | `docker compose exec -T db pg_dump -U thicket thicket > thicket-$(date +%F).sql` |
| Restore | `docker compose exec -T db psql -U thicket thicket < thicket-YYYY-MM-DD.sql` |
| Logs | `docker compose logs -f thicket` |
| Reset a password | `docker compose exec thicket node dist/scripts/passwd.js <handle> <new password>` |

Behind a reverse proxy (Traefik, Caddy, nginx): delete the `ports:` block,
route your hostname to the `thicket` container on 3000, and set `PUBLIC_URL`
to the https address. The cookie is marked Secure when `PUBLIC_URL` is https
or the proxy sends `X-Forwarded-Proto: https`.

Traefik labels, for the record:

```yaml
    labels:
      traefik.enable: "true"
      traefik.http.routers.thicket.rule: Host(`thicket.example.com`)
      traefik.http.routers.thicket.entrypoints: websecure
      traefik.http.routers.thicket.tls.certresolver: letsencrypt
      traefik.http.services.thicket.loadbalancer.server.port: "3000"
```

## Using an existing Postgres

Skip the `db` service and set `DATABASE_URL` yourself. Create an empty
database and a role that owns it; thicket creates its own tables. Use
`compose.external-db.yml`, which runs the app container only.

## Hosted platforms

The same image runs anywhere that runs a container and keeps it awake. thicket
polls feeds from inside the process, so platforms that scale to zero (Cloud
Run, Lambda-style) need a minimum of one instance or `SCHEDULER=off` plus an
external fetcher, which doesn't exist yet.

**Railway.** New project → deploy from the GitHub repo, or from the published
image. Railway's monorepo detection offers a service per package
(`@thicket/web`, `@thicket/api`) with `pnpm --filter …` start commands and
per-package watch paths — all wrong for thicket, which is one container. Keep
one service and, in its settings, set the start command to the image's CMD
(`node --enable-source-maps dist/index.js`; a dashboard start command overrides
it), clear the build command and watch paths, and set the health check to
`/api/health`.

Run **one service with one replica.** The feed fetcher runs inside the web
process, so every extra copy is another fetcher polling every feed; add replicas
only with `SCHEDULER=off` on the extras. Add a Postgres service in the same
region and set `DATABASE_URL` to its private URL (`${{Postgres.DATABASE_URL}}`);
set `PUBLIC_URL` to the Railway domain, or your own once it points there.

There is deliberately no `railway.toml`: Railway's config-as-code files are
deprecated, override the dashboard while they last, and stop being read on
2026-12-01.

**Supabase as the database.** Use the *direct* or *session-mode* connection
string from the dashboard, not the transaction-mode pooler; the transaction
pooler doesn't support the prepared statements the driver uses.

**fly.io.** `fly launch` reads the Dockerfile. Attach a Postgres, set
`PUBLIC_URL` to the Fly hostname, keep at least one machine running.

## Configuration

Everything is an environment variable; see `.env.example` for the full list
with comments. Only `DATABASE_URL` and `PUBLIC_URL` are required.

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | — | Postgres connection string |
| `PUBLIC_URL` | `http://localhost:3000` | Address of this instance; https → Secure cookies |
| `INSTANCE_NAME` | hostname of `PUBLIC_URL` | Shown on the sign-up page |
| `SIGNUPS` | `invite` | Initial policy: `open`, `invite`, `closed`. Admin can change at runtime |
| `TRACK_ACTIVITY` | `true` | Product analytics on/off for the whole instance |
| `SCHEDULER` | `on` | `off` disables the in-process fetcher |
| `FETCH_CONCURRENCY` | `8` | Parallel feed fetches |
| `RETAIN_ITEMS_DAYS` | `0` (off) | Delete posts older than this. Off by default on purpose: feeds serve a window, not an archive, so a deleted post is usually gone for good. Posts with notes on them are always kept |
| `RETAIN_FETCH_LOG_DAYS` | `90` | Delete fetch-log rows older than this |
| `RETAIN_EVENTS_DAYS` | `90` | Delete analytics events older than this |
| `PORT` | `3000` | Listen port |
| `HOSTED` | unset | readthicket.com only; leave unset on your own copy. Turns on what belongs to thicket's hosted service: public sign up, account email, and password reset |
| `SITE_URL` | unset | readthicket.com only. The private address of its own site (the landing page; github.com/mocha/readthicket-com). This server hands it `/` and `/_site/` and serves everything else, so both share one domain. Unset, `/` sends people to New posts or the login screen |
| `SMTP_URL` | unset | readthicket.com only. Outgoing mail for email confirmation and reset links: `smtp://user:pass@host:587`. Required when `HOSTED` is set; thicket won't start without it |
| `MAIL_FROM` | `thicket <no-reply@readthicket.com>` | readthicket.com only. The From line on every email |
| `GITHUB_TOKEN` | unset | readthicket.com only. A GitHub token that can read and write issues on `FEEDBACK_REPO`. Until it is set, feedback is saved and waits |
| `FEEDBACK_REPO` | `christielenn/thicket-feedback` | readthicket.com only. The private GitHub repository (`owner/name`) that "Send feedback" files issues in |
| `ANTHROPIC_API_KEY` | unset | readthicket.com only, optional. Lets Claude add feedback that repeats an open issue to that issue as a comment, instead of filing it again |
| `WEB_DIR` | set in the image | Built web app to serve; unset = API only |

## Building the image yourself

```sh
docker build -t thicket .
```

The build compiles the web app and the API and copies only production
dependencies into a `node:22-alpine` image running as the `node` user.

## Running without Docker

```sh
pnpm install
pnpm --filter @thicket/web build
pnpm --filter @thicket/api build
DATABASE_URL=... PUBLIC_URL=... WEB_DIR=packages/web/build node packages/api/dist/index.js
```

## Existing databases created before migrations

The original lab database was built with `drizzle-kit push`. Run
`pnpm db:baseline` once against it to record the initial migration as applied;
after that, boot-time migrations take over. New databases need nothing.

## Auditing migrations before an upgrade

Migrations are checked against every SQL hash in
`drizzle.__drizzle_migrations`, in journal order. An older migration merged
later is applied if its hash is missing, regardless of its timestamp.
Existing Drizzle history and baselines work without conversion. Never edit
SQL that has already been applied: its hash is its identity.
SQL files are checked out with LF line endings on every platform. The
`Migration integrity` PR check rejects modifications, renames, or deletions
of existing migration SQL; make subsequent changes in a new migration.

Before deploying the hash-based runner for the first time, compare the live
ledger with the full migration list in the new checkout:

```sh
pnpm --filter @thicket/api db:audit
# Or, from a built image with DATABASE_URL set, without starting the server:
node dist/scripts/audit-migrations.js
```

The audit uses `DATABASE_URL`, exactly like the server, and prints the target
host, port, and database without credentials or connection options. It never
automatically switches to `DATABASE_PUBLIC_URL`. If you need Railway's public
endpoint outside its private network, set `DATABASE_URL` to that endpoint
explicitly for the audit command.

The audit uses a read-only transaction and creates nothing. Save its output
with the deployment record. It lists every migration by name and hash, marks
missing migrations at or below the old timestamp cutoff as `SKIPPED by old
cutoff`, and reports recorded hashes absent from the checkout. It exits with
status 1 for previously skipped migrations, unmatched history, or an audit
error. Ordinary newer pending migrations exit successfully. Review the list before
restarting: the new runner will apply all missing migrations, including any
previously skipped ones. An unmatched hash may mean an applied SQL file was
edited, or this checkout is older than the database; resolve that history
before using it to upgrade.

Each boot logs the names it applies and a final committed list (or `none`).
Migration SQL and ledger entries commit together; if any statement fails,
the batch rolls back, the error identifies the migration and database reason,
and the server exits before listening. Overlapping boots serialize migration
checks with a transaction-scoped advisory lock.
Unmatched ledger hashes are also logged at boot. They do not prevent running
an older application image. If a pending migration has the same timestamp as
an unmatched recorded hash, boot refuses the batch before any migration SQL
runs: this suggests an applied file was edited. Restore its original bytes
and investigate the audit rather than replaying a possible data migration.
Postgres error details, hints, context, and statement positions are retained
in startup errors; deferred constraint errors are identified as commit failures.

## Rate limiting at the proxy

Don't. A page of the feed index fetches around fifty small icons at once and
the reader paginates as you scroll; a per-IP limiter sized for form posts
will throttle ordinary page loads and the app will show 429 errors that
aren't its own. If you must, allow bursts of at least 100 and exempt `/api/`.

Same goes for geoblock and bouncer middlewares (CrowdSec, fail2ban-style
plugins): they judge by connecting address, which behind a CDN or a NAT
hairpin is not the user's, and some of them answer with a bare 429 that
looks like the app's fault. Put them on other routers, or exempt this one.
And test the public address from outside your LAN: requests from a machine
next to the server take a different path and will pass.
