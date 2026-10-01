/**
 * The published description of the API against the API itself (issue #140):
 * every route a token can reach is described, and nothing else is. Imports
 * the routers but never talks to a database. Run with
 * `pnpm --filter @thicket/api test`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

// The routers import the database client, which wants an address at import time. It is never connected to here.
process.env.DATABASE_URL ??= "postgres://not-used-by-tests";
const { ROUTERS } = await import("../routes/index.js");
const { ENDPOINTS, openApiDocument } = await import("./openapi.js");
const { tokenMay } = await import("./token-access.js");

const sample = (path: string) => path.replace(/:[A-Za-z]+/g, "1");
const key = (method: string, path: string) => `${method} ${path}`;

/** Every route the API serves, as "METHOD /api/path/:param". */
const routes = ROUTERS.flatMap(([base, router]) => router.routes
  .filter((r) => r.method !== "ALL")
  .map((r) => key(r.method, base + (r.path === "/" ? "" : r.path))));
const described = new Set(ENDPOINTS.map((e) => key(e.method, e.path)));

test("there are routes to check", () => {
  assert.ok(routes.length > 80, `found ${routes.length}`);
});

test("every route a token can reach is in the description", () => {
  const missing = routes.filter((r) => {
    const [method, path] = r.split(" ");
    return tokenMay("full", method, sample(path)).ok && !described.has(r);
  });
  assert.deepEqual(missing, [], "add these to ENDPOINTS in lib/openapi.ts, or to NEVER in lib/token-access.ts if a token should not reach them");
});

test("the description lists only real routes that a token can reach", () => {
  const real = new Set(routes);
  for (const e of ENDPOINTS) {
    assert.ok(real.has(key(e.method, e.path)), `${e.method} ${e.path} is not a route`);
    assert.equal(tokenMay("full", e.method, sample(e.path)).ok, true, `${e.method} ${e.path} is described, but no token may reach it`);
  }
  assert.equal(described.size, ENDPOINTS.length, "no endpoint is listed twice");
});

test("no route that no token may reach is described", () => {
  const doc = JSON.stringify(openApiDocument("https://example.test"));
  for (const off of ["/api/admin", "/api/tokens", "/api/import", "/api/events", "/api/auth/login", "/api/auth/me/password"]) assert.ok(!doc.includes(`"${off}`), off);
});

test("each operation says which kind of token it needs, and that matches what the middleware enforces", () => {
  const doc = openApiDocument("https://example.test") as any;
  assert.equal(doc.openapi, "3.0.3");
  assert.deepEqual(Object.keys(doc.components.securitySchemes), ["readOnlyToken", "fullAccessToken"]);
  for (const s of Object.values<any>(doc.components.securitySchemes)) assert.deepEqual([s.type, s.scheme], ["http", "bearer"]);
  let operations = 0;
  for (const e of ENDPOINTS) {
    const op = doc.paths[e.path.replace(/:([A-Za-z]+)/g, "{$1}")][e.method.toLowerCase()];
    operations++;
    const readOk = tokenMay("read", e.method, sample(e.path)).ok;
    assert.equal(op["x-token-access"], readOk ? "read" : "full", `${e.method} ${e.path}`);
    assert.deepEqual(op.security.map((s: object) => Object.keys(s)[0]), readOk ? ["readOnlyToken", "fullAccessToken"] : ["fullAccessToken"]);
    assert.ok(op.responses["429"] && op.responses["403"] && op.responses["401"]);
    for (const [, name] of e.path.matchAll(/:([A-Za-z]+)/g)) assert.ok(op.parameters.some((p: any) => p.in === "path" && p.name === name), `${e.path} declares {${name}}`);
  }
  assert.equal(operations, ENDPOINTS.length);
  const ids = ENDPOINTS.map((e) => doc.paths[e.path.replace(/:([A-Za-z]+)/g, "{$1}")][e.method.toLowerCase()].operationId);
  assert.equal(new Set(ids).size, ids.length, "operation ids are unique");
});

test("the rate limits are stated, with the numbers the server uses", () => {
  const doc = openApiDocument("https://example.test");
  assert.match(doc.info.description, /10 requests in any 10 seconds and 120 in any hour/);
  assert.match(doc.info.description, /Retry-After/);
  assert.match(doc.components.responses.TooMany.description, /10 in 10 seconds or 120 in an hour/);
  assert.equal(doc.servers[0].url, "https://example.test");
});
