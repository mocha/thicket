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

## Saved display settings for new devices

Each browser keeps its own display settings. The account keeps one saved
copy, kept up to date by the device with "Use these settings on new devices"
checked at the top of Settings. Each localhost port counts as a separate
device to the browser.

- **New-device question:** with the box checked somewhere, open a private
  window and sign in. Setup asks "Use your saved settings?" first.
- **Older-account default:** make an account look like it's from before saved
  settings existed. The next device it opens gets the box checked
  automatically, with no prompt:

  ```sh
  docker exec thicket-dev-db psql -U thicket -d thicket \
    -c "update users set display_offer_answered_at = null, saved_display = null, display_source = null where handle = '<handle>'"
  ```

- **Test in the front tab.** Chrome holds a closing window's signal while
  its tab is in the background, so setup's save-on-close only happens once
  the tab is shown again.
