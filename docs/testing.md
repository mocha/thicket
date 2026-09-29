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
