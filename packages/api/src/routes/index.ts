/**
 * Every part of the API and where it is mounted. index.ts mounts them from
 * this list, and the published description of the API is checked against it
 * (lib/openapi.test.ts), so a route added here cannot be left out of either.
 */
import type { Hono } from "hono";
import { river } from "./river.js";
import { feeds } from "./feeds.js";
import { collections } from "./collections.js";
import { events } from "./events.js";
import { bookmarks } from "./bookmarks.js";
import { auth } from "./auth.js";
import { users } from "./users.js";
import { profiles } from "./profiles.js";
import { admin } from "./admin.js";
import { explore } from "./explore.js";
import { notes } from "./notes.js";
import { search } from "./search.js";
import { items } from "./items.js";
import { marks } from "./marks.js";
import { imports } from "./imports.js";
import { tokens } from "./tokens.js";
import { feedback } from "./feedback.js";

export const ROUTERS: [base: string, router: Hono][] = [
  ["/api/auth", auth],
  ["/api/users", users],
  ["/api/admin", admin],
  ["/api/explore", explore],
  ["/api/search", search],
  ["/api/profiles", profiles],
  ["/api/river", river],
  ["/api/feeds", feeds],
  ["/api/collections", collections],
  ["/api/events", events],
  ["/api/bookmarks", bookmarks],
  ["/api/notes", notes],
  ["/api/items", items],
  ["/api/marks", marks],
  ["/api/import", imports],
  ["/api/tokens", tokens],
  ["/api/feedback", feedback],
];
