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

**Railway.** New project → Deploy from repo (it finds the Dockerfile) or from
the published image. Add a Postgres service or point `DATABASE_URL` at
Supabase. Set `PUBLIC_URL` to the Railway domain (or your CNAME).

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
