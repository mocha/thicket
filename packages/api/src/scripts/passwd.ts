/**
 * Set or reset a user's password from the shell. The instance has no email, so
 * this is the recovery path: pnpm passwd <handle> <new password>
 * Also renames a handle: pnpm passwd <handle> <new password> --rename <new handle>
 * Signs the user out everywhere.
 */
import { eq } from "drizzle-orm";
import { db, schema } from "../db/client.js";
import { destroyAllSessions, handleProblem, hashPassword, normalizeHandle } from "../lib/auth.js";

const [handleRaw, password, flag, renameRaw] = process.argv.slice(2);
if (!handleRaw || !password) {
  console.error("usage: pnpm passwd <handle> <new password> [--rename <new handle>]");
  process.exit(1);
}
const handle = normalizeHandle(handleRaw);
const [user] = await db.select().from(schema.users).where(eq(schema.users.handle, handle));
if (!user) {
  console.error(`no user with handle ${handle}`);
  process.exit(1);
}
if (password.length < 8) {
  console.error("password must be at least 8 characters");
  process.exit(1);
}
const patch: Partial<typeof schema.users.$inferInsert> = { passwordHash: await hashPassword(password) };
if (flag === "--rename" && renameRaw) {
  const next = normalizeHandle(renameRaw);
  const problem = handleProblem(next);
  if (problem) { console.error(problem); process.exit(1); }
  patch.handle = next;
}
await db.update(schema.users).set(patch).where(eq(schema.users.id, user.id));
await destroyAllSessions(user.id);
console.log(`updated @${patch.handle ?? handle}; all sessions signed out`);
process.exit(0);
