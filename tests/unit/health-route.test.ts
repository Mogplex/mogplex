import assert from "node:assert/strict";
import test from "node:test";
import { createHealthGetHandler } from "../../app/api/health/route";

test("GET /api/health returns 200 with no-store when the database answers", async () => {
  const GET = createHealthGetHandler({
    env: { AI_GATEWAY_API_KEY: "gateway-secret" },
    databaseUrl: () => "postgres://db",
    queryDatabase: () => Promise.resolve({ rows: [] }),
  });

  const response = await GET();
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(body.status, "ok");
  assert.equal(body.checks.database, "ok");
  assert.equal(body.checks.models, "configured");
  assert.doesNotMatch(JSON.stringify(body), /gateway-secret/);
});

test("GET /api/health returns 503 without the error message when the database fails", async () => {
  const GET = createHealthGetHandler({
    env: {},
    databaseUrl: () => "postgres://db",
    queryDatabase: () =>
      Promise.reject(new Error("connect ECONNREFUSED 10.0.0.5:5432")),
  });

  const response = await GET();
  const text = await response.text();

  assert.equal(response.status, 503);
  assert.equal(JSON.parse(text).checks.database, "error");
  assert.doesNotMatch(text, /ECONNREFUSED|10\.0\.0\.5/);
});

test("GET /api/health returns 503 and skips the query when no database is configured", async () => {
  let queried = false;
  const GET = createHealthGetHandler({
    env: {},
    databaseUrl: () => "",
    queryDatabase: () => {
      queried = true;
      return Promise.resolve();
    },
  });

  const response = await GET();
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.equal(body.checks.database, "unconfigured");
  assert.equal(queried, false);
});
