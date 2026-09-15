-- Accounts on platforms get their own picture instead of the platform's logo
-- (feeds/icons.ts). Every YouTube channel wore YouTube's icon, because a
-- feed's icon came from its website and a channel's website is YouTube.
--
-- Clearing icon_checked_at makes the next ordinary fetch of each such feed look
-- again, now for the account's picture first. The feeds are fetched on their
-- usual schedule, so this spreads over a day rather than arriving at once, and
-- every request waits its turn per host. A feed whose picture can't be found
-- ends up with the icon it had.
--
-- Reddit is left out: its pages answer non-browsers with a script challenge,
-- and its feeds carry only Reddit's own icon, so there is nothing to find.
--
-- Code on the previous revision simply rechecks these the old way, so rolling
-- back needs nothing.

update feeds set icon_checked_at = null
where url !~* '^https?://([a-z0-9-]+\.)?reddit\.com/'
  and (
    url ~* '^https?://([a-z0-9-]+\.)?youtube\.com/'
    or url ~* '^https?://[^/]+/(@[^/]+|users?/[^/]+|u/[^/]+|profile/[^/]+)'
    or split_part(url, '/', 3) ~* '(^|\.)(medium\.com|bsky\.app|github\.com|gitlab\.com|twitch\.tv|vimeo\.com|soundcloud\.com|letterboxd\.com|micro\.blog|dev\.to|write\.as)$'
  );
