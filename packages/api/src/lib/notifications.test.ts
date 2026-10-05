/**
 * Notifications (issue #184) are decided in `assemble`, from rows the database
 * hands it, so the rules are tested here without one: who is named, what
 * supersedes what, what stays hidden, and what counts as new. Also the
 * @mention rule the notes and the web app share. Run with
 * `pnpm --filter @thicket/api test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";

// The modules import the database client, which wants an address at import time. It is never connected to here.
process.env.DATABASE_URL ??= "postgres://not-used-by-tests";
const { assemble, CAP, parseRange } = await import("./notifications.js");
const { mentionedHandles } = await import("./mentions.js");
const { notifications } = await import("../routes/notifications.js");
type Candidates = import("./notifications.js").Candidates;
type SaveRow = Candidates["saves"][number];
type MentionRow = Candidates["mentions"][number];

const ME = 7;
const NOW = Date.parse("2026-10-03T12:00:00Z");
const ago = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const SINCE = ago(30 * 24);
/** Seen two hours ago: anything in the last two hours is new. */
const opts = { seenAt: ago(2), since: SINCE };

let nextId = 100;
function author(over: Partial<SaveRow["author"]> = {}): SaveRow["author"] {
  const id = over.id ?? nextId++;
  return {
    id, handle: `u${id}`, displayName: null, avatarUpdatedAt: null,
    profileVisibility: "public", bookmarksVisibility: "public", notesVisibility: "public", activityVisibility: "public",
    followsMe: false, ...over,
  };
}
const post = { url: "https://example.com/a", title: "A post", siteTitle: "Example", feedId: 1, hasIcon: false };
function save(over: Partial<SaveRow> = {}): SaveRow {
  return { id: nextId++, author: author(), post, savedAt: ago(1), noteCreatedAt: null, followedAt: ago(365 * 24), ...over };
}
function mention(over: Partial<MentionRow> = {}): MentionRow {
  return { id: nextId++, author: author(), at: ago(1), bookmark: { id: 1 }, ...over };
}
const none: Candidates = { follows: [], saves: [], mentions: [] };
const kinds = (r: ReturnType<typeof assemble>) => r.items.map((n) => n.kind);

test("a new follower is a notification, named by handle", () => {
  const r = assemble(ME, { ...none, follows: [{ at: ago(1), person: { id: 3, handle: "ana", displayName: "Ana", avatarUpdatedAt: null, profileVisibility: "public" } }] }, opts);
  assert.deepEqual(kinds(r), ["follow"]);
  assert.equal(r.items[0].person.handle, "ana");
  assert.equal(r.items[0].isNew, true);
  assert.equal(r.count, 1);
});

test("a follower with a private profile is not named, as on the Followers list", () => {
  const r = assemble(ME, { ...none, follows: [{ at: ago(1), person: { id: 3, handle: "ana", displayName: null, avatarUpdatedAt: null, profileVisibility: "private" } }] }, opts);
  assert.deepEqual(r.items, []);
  assert.equal(r.count, 0);
});

test("a bookmark by someone I follow is one line about the post", () => {
  const r = assemble(ME, { ...none, saves: [save()] }, opts);
  assert.deepEqual(kinds(r), ["bookmark"]);
  assert.deepEqual((r.items[0] as { post: unknown }).post, post);
});

test("a note supersedes its bookmark: a noted post appears once, as the note", () => {
  const r = assemble(ME, { ...none, saves: [save({ savedAt: ago(5), noteCreatedAt: ago(1) })] }, opts);
  assert.deepEqual(kinds(r), ["note"]);
  assert.equal(r.items[0].at, ago(1));
});

test("a note I may not read shows as the bookmark it lives on, when bookmarks are shared", () => {
  const r = assemble(ME, { ...none, saves: [save({ author: author({ notesVisibility: "friends" }), noteCreatedAt: ago(1) })] }, opts);
  assert.deepEqual(kinds(r), ["bookmark"]);
  const hidden = assemble(ME, { ...none, saves: [save({ author: author({ notesVisibility: "friends", bookmarksVisibility: "private" }), noteCreatedAt: ago(1) })] }, opts);
  assert.deepEqual(hidden.items, []);
});

test("bookmarks and notes follow the author's sharing: friends means the people they follow", () => {
  const friendsOnly = { bookmarksVisibility: "friends", notesVisibility: "friends" } as const;
  assert.deepEqual(kinds(assemble(ME, { ...none, saves: [save({ author: author(friendsOnly) })] }, opts)), []);
  assert.deepEqual(kinds(assemble(ME, { ...none, saves: [save({ author: author({ ...friendsOnly, followsMe: true }) })] }, opts)), ["bookmark"]);
  // A private profile, or recent activity not shared with me, shows nothing.
  assert.deepEqual(kinds(assemble(ME, { ...none, saves: [save({ author: author({ profileVisibility: "private" }) })] }, opts)), []);
  assert.deepEqual(kinds(assemble(ME, { ...none, saves: [save({ author: author({ activityVisibility: "private" }) })] }, opts)), []);
});

test("a mention notifies only when the mentioned person may read the note", () => {
  assert.deepEqual(kinds(assemble(ME, { ...none, mentions: [mention()] }, opts)), ["mention"]);
  assert.deepEqual(kinds(assemble(ME, { ...none, mentions: [mention({ author: author({ notesVisibility: "private" }) })] }, opts)), []);
  assert.deepEqual(kinds(assemble(ME, { ...none, mentions: [mention({ author: author({ notesVisibility: "friends" }) })] }, opts)), []);
  assert.deepEqual(kinds(assemble(ME, { ...none, mentions: [mention({ author: author({ notesVisibility: "friends", followsMe: true }) })] }, opts)), ["mention"]);
  assert.deepEqual(kinds(assemble(ME, { ...none, mentions: [mention({ author: author({ profileVisibility: "private" }) })] }, opts)), []);
});

test("a mention needs no follow, and its recent activity setting does not hide it", () => {
  const r = assemble(ME, { ...none, mentions: [mention({ author: author({ activityVisibility: "private" }) })] }, opts);
  assert.deepEqual(kinds(r), ["mention"]);
});

test("a mention supersedes the plain noted line for the same note", () => {
  const a = author();
  const s = save({ author: a, noteCreatedAt: ago(1) });
  const r = assemble(ME, { ...none, saves: [s], mentions: [mention({ id: s.id, author: a })] }, opts);
  assert.deepEqual(kinds(r), ["mention"]);
});

test("nothing I did myself", () => {
  const mine = author({ id: ME });
  const r = assemble(ME, {
    follows: [{ at: ago(1), person: { id: ME, handle: "me", displayName: null, avatarUpdatedAt: null, profileVisibility: "public" } }],
    saves: [save({ author: mine }), save({ author: mine, noteCreatedAt: ago(1) })],
    mentions: [mention({ author: mine })],
  }, opts);
  assert.deepEqual(r.items, []);
});

test("newest first; older than the window is left out", () => {
  const r = assemble(ME, { ...none, saves: [save({ savedAt: ago(10) }), save({ savedAt: ago(1) }), save({ savedAt: ago(31 * 24) })] }, opts);
  assert.deepEqual(r.items.map((n) => n.at), [ago(1), ago(10)]);
});

test("new means after seen-at; seeing everything clears the count", () => {
  const c = { ...none, saves: [save({ savedAt: ago(1) }), save({ savedAt: ago(3) })] };
  const before = assemble(ME, c, opts);
  assert.deepEqual(before.items.map((n) => n.isNew), [true, false]);
  assert.equal(before.count, 1);
  const after = assemble(ME, c, { seenAt: ago(0), since: SINCE });
  assert.equal(after.count, 0);
  assert.equal(after.items.length, 2, "seen notifications stay in the list");
  assert.ok(after.items.every((n) => !n.isNew));
});

test("the count stops at the cap and says there is more", () => {
  const saves = Array.from({ length: CAP + 5 }, (_, i) => save({ savedAt: new Date(NOW - i * 1000).toISOString() }));
  const r = assemble(ME, { ...none, saves }, opts);
  assert.equal(r.items.length, CAP);
  assert.equal(r.count, CAP);
  assert.equal(r.more, true);
});

test("@mentions: handles at a word's start, not in addresses or links", () => {
  assert.deepEqual(mentionedHandles("Thanks @Ana and @bob_2, cc @ana."), ["ana", "bob_2"]);
  assert.deepEqual(mentionedHandles("(@carol) @dave-x!"), ["carol", "dave-x"]);
  assert.deepEqual(mentionedHandles("mail me@example.com or see https://example.com/@ana"), []);
  assert.deepEqual(mentionedHandles("@a is too short, @@ana is not one"), []);
});

test("notifications need someone signed in", async () => {
  const a = new Hono();
  a.use("*", async (c, next) => { c.set("user", null); await next(); });
  a.route("/api/notifications", notifications);
  for (const [method, path] of [["GET", ""], ["GET", "/count"], ["POST", "/seen"]]) {
    const r = await a.request(`/api/notifications${path}`, { method });
    assert.equal(r.status, 401, `${method} ${path}`);
  }
});

test("a range: only what happened after since and up to until", () => {
  const c = { ...none, saves: [save({ savedAt: ago(1) }), save({ savedAt: ago(30) }), save({ savedAt: ago(100) })] };
  const r = assemble(ME, c, { ...opts, since: ago(48), until: ago(24) });
  assert.deepEqual(r.items.map((n) => n.at), [ago(30)]);
});

test("a range of kinds; a mention stays a mention when asking for notes", () => {
  const ana = author();
  const n = save({ author: ana, noteCreatedAt: ago(1) });
  const c = { ...none, saves: [n, save()], mentions: [mention({ id: n.id, author: ana })] };
  assert.deepEqual(kinds(assemble(ME, c, { ...opts, kinds: ["bookmark"] })), ["bookmark"]);
  assert.deepEqual(kinds(assemble(ME, c, { ...opts, kinds: ["note"] })), []);
  assert.deepEqual(kinds(assemble(ME, c, { ...opts, kinds: ["mention", "note"] })), ["mention"]);
});

test("truncated says the list stopped at the cap with more in range", () => {
  const many = Array.from({ length: CAP + 1 }, (_, i) => save({ savedAt: ago(i + 1) }));
  assert.equal(assemble(ME, { ...none, saves: many }, opts).truncated, true);
  assert.equal(assemble(ME, { ...none, saves: many.slice(0, CAP) }, opts).truncated, false);
});

test("since and until read as a script would write them", () => {
  const ok = (q: Parameters<typeof parseRange>[0]) => {
    const r = parseRange(q, NOW);
    assert.ok(!("error" in r), JSON.stringify(r));
    return r as Exclude<typeof r, { error: string }>;
  };
  assert.deepEqual(ok({}), { since: ago(30 * 24), until: ago(0), kinds: null });
  assert.equal(ok({ since: "24h" }).since, ago(24));
  assert.equal(ok({ since: "7d" }).since, ago(7 * 24));
  // A day starts a range at its start and ends one at its end.
  assert.deepEqual(ok({ since: "2026-09-01", until: "2026-09-02" }), { since: "2026-09-01T00:00:00.000Z", until: "2026-09-03T00:00:00.000Z", kinds: null });
  assert.equal(ok({ since: "2026-10-03T09:30:00Z" }).since, "2026-10-03T09:30:00.000Z");
  // A future until is now.
  assert.equal(ok({ until: "2027-01-01" }).until, ago(0));
  assert.deepEqual(ok({ kind: "follow, mention" }).kinds, ["follow", "mention"]);
  for (const q of [{ since: "yesterday" }, { since: "3w" }, { until: "10/01/2026" }, { since: "400d" }, { since: "1h", until: "2h" }, { kind: "likes" }]) {
    assert.ok("error" in parseRange(q, NOW), JSON.stringify(q));
  }
});

test("a range that can't be read is refused before anything is looked up", async () => {
  const a = new Hono();
  a.use("*", async (c, next) => { c.set("user", { id: ME, handle: "me" } as never); await next(); });
  a.route("/api/notifications", notifications);
  const r = await a.request("/api/notifications?since=yesterday");
  assert.equal(r.status, 400);
  assert.match((await r.json() as { error: string }).error, /since/);
});

test("only what they did after I followed them: a new follow brings no history", () => {
  const followedAt = ago(10);
  const c = { ...none, saves: [
    save({ followedAt, savedAt: ago(48), post: { ...post, title: "before" } }),
    save({ followedAt, savedAt: ago(2), post: { ...post, title: "after" } }),
    // Saved before, noted after: the note is new to me, so it counts.
    save({ followedAt, savedAt: ago(48), noteCreatedAt: ago(1), post: { ...post, title: "noted after" } }),
    // Saved and noted before: neither counts, and the bookmark doesn't stand in for the note.
    save({ followedAt, savedAt: ago(48), noteCreatedAt: ago(20), post: { ...post, title: "noted before" } }),
  ] };
  const r = assemble(ME, c, opts);
  assert.deepEqual(r.items.map((n) => `${n.kind}:${(n as { post: { title: string } }).post.title}`), ["note:noted after", "bookmark:after"]);
});

test("a mention from before I followed them still arrives", () => {
  const ana = author();
  const n = save({ author: ana, followedAt: ago(1), noteCreatedAt: ago(5) });
  const r = assemble(ME, { ...none, saves: [n], mentions: [mention({ id: n.id, author: ana, at: ago(5) })] }, opts);
  assert.deepEqual(kinds(r), ["mention"]);
});
