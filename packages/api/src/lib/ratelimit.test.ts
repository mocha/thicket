/**
 * The counting behind every limit, and the limits on saving (issue #136).
 * Pure: no database, no server. Run with `pnpm --filter @thicket/api test`.
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { LIMITS, hit } from "./ratelimit.js";

test("a window lets its limit through and refuses the next", () => {
  const limit = { limit: 3, windowMs: 60_000 };
  for (let i = 0; i < 3; i++) assert.equal(hit("t:window", limit).ok, true);
  const over = hit("t:window", limit);
  assert.equal(over.ok, false);
  assert.ok(over.retryAfterS >= 1 && over.retryAfterS <= 60, "says how long to wait");
});

test("keys are counted apart, so one account's saving never spends another's", () => {
  const limit = { limit: 1, windowMs: 60_000 };
  assert.equal(hit("t:apart:1", limit).ok, true);
  assert.equal(hit("t:apart:1", limit).ok, false);
  assert.equal(hit("t:apart:2", limit).ok, true);
});

test("a batch counts as many as it holds", () => {
  const limit = { limit: 20, windowMs: 60_000 };
  assert.equal(hit("t:batch", limit, 8).ok, true);
  assert.equal(hit("t:batch", limit, 8).ok, true);
  assert.equal(hit("t:batch", limit, 8).ok, false, "24 is past 20");
  assert.equal(hit("t:batch-first", limit, 21).ok, false, "even the first batch, if it is too big alone");
});

test("the window opens again once its time is up", () => {
  mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-01T09:00:00Z") });
  try {
    const limit = { limit: 1, windowMs: 60_000 };
    assert.equal(hit("t:reopen", limit).ok, true);
    assert.equal(hit("t:reopen", limit).ok, false);
    mock.timers.tick(59_000);
    assert.equal(hit("t:reopen", limit).retryAfterS, 1);
    mock.timers.tick(1_000);
    assert.equal(hit("t:reopen", limit).ok, true);
  } finally {
    mock.timers.reset();
  }
});

test("saving: 500 a day goes through, the 501st is refused until the same time tomorrow", () => {
  mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-01T09:00:00Z") });
  try {
    assert.equal(LIMITS.savesPerDay.limit, 500);
    for (let i = 0; i < 500; i++) assert.equal(hit("t:saves", LIMITS.savesPerDay).ok, true, `save ${i + 1}`);
    const over = hit("t:saves", LIMITS.savesPerDay);
    assert.equal(over.ok, false);
    assert.equal(over.retryAfterS, 24 * 3600);
    mock.timers.tick(24 * 3600_000 - 1);
    assert.equal(hit("t:saves", LIMITS.savesPerDay).ok, false, "still the same day");
    mock.timers.tick(1);
    assert.equal(hit("t:saves", LIMITS.savesPerDay).ok, true, "tomorrow");
  } finally {
    mock.timers.reset();
  }
});

test("notes have their own daily count, apart from saves", () => {
  assert.equal(LIMITS.noteWritesPerDay.windowMs, 24 * 3600_000);
  for (let i = 0; i < LIMITS.noteWritesPerDay.limit; i++) hit("t:notes:9", LIMITS.noteWritesPerDay);
  assert.equal(hit("t:notes:9", LIMITS.noteWritesPerDay).ok, false);
  assert.equal(hit("t:saves:9", LIMITS.savesPerDay).ok, true);
});

test("the import check counts feeds, not requests: a few hundred fit, thousands do not", () => {
  const BATCH = 8;
  let checked = 0;
  while (hit("t:import", LIMITS.importCheck, BATCH).ok) checked += BATCH;
  assert.equal(checked, LIMITS.importCheck.limit);
  assert.ok(checked >= 300, "a real import of a few hundred feeds is checked in one go");
  assert.ok(checked <= 1000, "and it is no longer a way to have thicket fetch thousands of addresses an hour");
});
