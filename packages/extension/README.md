# thicket Firefox prototype

A build-free WebExtension for issue [#96](https://github.com/mocha/thicket/issues/96).
It finds advertised RSS, Atom and JSON feeds, follows them into a collection,
and saves the current page as a bookmark with an optional note. It uses the
existing API; no server changes or dependencies are required.

## Try it in Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on** and select this directory's `manifest.json`.
3. Open the extension's **Connection settings** from its toolbar popup.
4. Enter your instance address (default: `https://readthicket.com`). Open its
   Account page, create or copy a **full-access** API token, and paste it into
   the extension. Click **Connect** and approve access to that instance.
   For local development use `http://localhost:5173` with the web/API proxy.
5. Optionally click **Enable automatic feed badges** and approve access to
   HTTP/HTTPS pages. Reload existing tabs. The icon is grey on pages without
   usable feeds and green when feeds or a known follow are available. Bookmarking remains available from the grey icon.
   A **✓** means you already follow this site. A number means the page
   advertises feeds and this browser has no cached follow for the site. Without
   this permission, discovery runs when you click the icon, using `activeTab`.
6. Visit a site and click the toolbar icon. Existing follows show **In Tech News**
   or **In 2 collections**, matching the app. Feeds already in the selected
   collection cannot be added again; choose another collection to add there.
   Choose a feed and collection, then **Follow** or **Add to this collection**. If no feed link is advertised, the popup can ask
   thicket to discover a feed from the page address, including supported
   YouTube and Reddit URLs. Multiple API candidates appear in the feed picker.
7. Use **Save bookmark** to save the page title and URL, optionally with a
   note. A nonempty note replaces your existing note if this URL is already
   bookmarked; a blank note leaves any existing note alone.

Temporary add-ons are removed when Firefox restarts. Re-load the manifest
while iterating, and reload page tabs after changes to discovery code.

## Scope and limitations

- Firefox desktop 128+ and Manifest V3. No bundler, framework, or build step.
- Manual token setup uses the API's existing full-access token. It does not
  mint a separate extension credential. Disconnect removes the locally stored
  token; revoke it on the Account page if needed.
- Discovery reads top-frame feed links on page load or popup open. It never
  sends browsing history or discovered URLs to the instance automatically.
  Following is cached locally from your API reading list. It refreshes when
  connecting, on popup open after five minutes, and after adding a feed.
  Tab loads use only this local list. Changes made in the web app may take
  up to five minutes and another popup open to reach the badge.
  Publisher links are hints, validated by thicket when followed. Dynamic feed
  links update when the popup opens; there is no mutation observer.
- Badges only; page banners and automatic account/key handoff are deferred.
- Feed discovery still works from a page URL when no advertised link exists.
  Firefox's protected pages may prohibit inspection. HTTP/HTTPS page URLs can
  still be bookmarked when inspection is unavailable.
- A bookmark and its note are separate API requests. Partial success is
  reported explicitly; retrying saves the same URL again without duplication.
- The token is in local extension storage, never sync storage or content
  scripts. Requests omit cookies and refuse redirects. Remote instances must
  use HTTPS; HTTP is allowed for localhost development.
- This is an unpacked prototype, not a signed or store-ready release. Browser
  permission prompts and real-instance interaction still need a manual pass.

## Verify

```sh
node packages/extension/test/core.test.js
# Or with the repository's package manager:
pnpm --filter @thicket/extension test
```

Tests cover feed-link discovery and deduplication, instance validation,
bearer-token requests, API discovery/rate-limit failures, and bookmark/note
partial success. For a manual pass, check: connection with a valid/revoked
key; multiple advertised feeds; a page without feed links; collection choice;
bookmark with and without a note; denied permissions; and page navigation
clearing the badge. Confirm the results in thicket.

## Investigating tab lag

Connection settings has **Disable automatic feed badges**. It unregisters the
page script for future navigations. Reload existing tabs to remove old script
listeners, then compare opening the same pages with automatic discovery on and
off, keeping the popup closed. For a complete extension comparison, disable
thicket in `about:addons` and repeat. Use Firefox's `about:processes` to observe
CPU and memory; extension processes can contain multiple add-ons, so a process
spike alone does not identify thicket.

Automatic discovery scans only the document head once and sends one background
message per page so a locally cached follow can show a checkmark even on a
page without advertised feeds. Repeated popup injection cannot add duplicate
listeners. There are no network requests during tab loads. These reductions
are covered by tests; they do not establish the cause of any observed lag.

## Chromium later

`core.js` is independent of browser lifecycle APIs. Browser-facing scripts use
`browser || chrome` and promise APIs. A Chromium build will need a generated
manifest with `background.service_worker` instead of Firefox's
`background.scripts`, Chromium-compatible icons, and no
`browser_specific_settings`. The background code uses no DOM, and its per-tab state is disposable; the
following list is restored from local storage when the background starts. Verify permissions and
messaging behavior in Chromium before claiming support. Firefox's background
manifest behavior is documented in
[MDN](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background).
