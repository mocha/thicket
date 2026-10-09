import assert from "node:assert/strict";
import { test } from "node:test";
import { migrationChecklist, type Migration } from "../db/migrations.js";
import { auditDatabaseUrl, auditExitCode, auditTarget } from "./audit-migrations.js";

test("the audit targets the runner's DATABASE_URL even when a public URL is also set", () => {
  assert.equal(auditDatabaseUrl({ DATABASE_URL: "postgres://runner/database", DATABASE_PUBLIC_URL: "postgres://other/database" }), "postgres://runner/database");
  assert.throws(() => auditDatabaseUrl({ DATABASE_PUBLIC_URL: "postgres://other/database" }), /DATABASE_URL is not set/);
});

test("audit output identifies the target without credentials or connection options", () => {
  assert.equal(auditTarget("postgres://admin:secret%40password@db.example:6543/thicket?application_name=secret&password=secret"), "db.example:6543/thicket");
  assert.equal(auditTarget("postgresql://admin:secret@localhost/thicket"), "localhost:5432/thicket");
  assert.equal(auditTarget("postgres://admin:secret@nominal.example/nominal?host=actual.example&port=6543"), "actual.example:6543/nominal");
});

const older: Migration = { tag: "older", when: 10, hash: "older-hash", statements: [] };
const newer: Migration = { tag: "newer", when: 20, hash: "newer-hash", statements: [] };

test("an audit succeeds with ordinary pending migrations, including a fresh database", () => {
  assert.equal(auditExitCode(migrationChecklist([older, newer], [{ hash: older.hash, created_at: 10 }])), 0);
  assert.equal(auditExitCode(migrationChecklist([older, newer], [])), 0);
  assert.equal(auditExitCode(migrationChecklist([], [])), 0);
});

test("an audit fails for previously skipped migrations or unmatched history", () => {
  assert.equal(auditExitCode(migrationChecklist([older, newer], [{ hash: newer.hash, created_at: 20 }])), 1);
  assert.equal(auditExitCode(migrationChecklist([older], [{ hash: older.hash, created_at: 10 }, { hash: "unknown", created_at: 30 }])), 1);
});
