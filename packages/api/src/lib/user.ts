/**
 * Current-user resolution now lives in lib/auth.ts (session cookie → user).
 * This module re-exports the names routes already import so the seam stays
 * where it was: currentUser(c) for "my" data, c.get("user") for optional.
 */
export { currentUser, trackingEnabled, type SessionUser } from "./auth.js";
