# Testing

## Email

thicket never prints messages to the log, because they carry live reset links.
To see them in dev, run a local mail catcher such as [Mailpit](https://mailpit.axllent.org)
and point thicket at it:

```sh
docker run --rm -p 1025:1025 -p 8025:8025 axllent/mailpit
# in .env
HOSTED=true
SMTP_URL=smtp://localhost:1025
```

Every message thicket sends shows up at http://localhost:8025, and the links
in it work.

## Setup and the tour

Setup opens once per browser, and the tour at its end once per account, so
after the first run neither comes back on its own. In dev, add `?setup` to
any address (for example http://localhost:5173/new-posts?setup) to open
setup again with the tour included, even for an account that has seen it.

To see the real once-per-account behavior instead, clear the account's
record in the dev database and use a private window, which has no saved
display settings:

```sh
docker exec thicket-dev-db psql -U thicket -d thicket \
  -c "update users set tour_seen_at = null where handle = '<handle>'"
```
