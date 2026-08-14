import assert from "node:assert/strict";
import test from "node:test";
import { NextResponse } from "next/server";

async function loadRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/github/repos/availability/route");
}

test("GET availability preserves authentication failures", async () => {
  const { createGithubRepoAvailabilityGetHandler } = await loadRoute();
  let checks = 0;
  const handler = createGithubRepoAvailabilityGetHandler({
    requireUserId: async () =>
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    checkAvailability: async () => {
      checks += 1;
      return "available";
    },
  });

  const response = await handler(
    new Request(
      "http://localhost/api/github/repos/availability?owner=alex&name=widgets"
    )
  );

  assert.equal(response.status, 401);
  assert.equal(checks, 0);
});

test("GET availability rejects invalid names before calling GitHub", async () => {
  const { createGithubRepoAvailabilityGetHandler } = await loadRoute();
  let checks = 0;
  const handler = createGithubRepoAvailabilityGetHandler({
    requireUserId: async () => "user-123",
    getGithubToken: async () => "token",
    checkAvailability: async () => {
      checks += 1;
      return "available";
    },
  });

  const response = await handler(
    new Request(
      "http://localhost/api/github/repos/availability?owner=alex&name=.."
    )
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    availability: "invalid",
    error: "Choose a repository name other than . or ...",
  });
  assert.equal(checks, 0);
});

test("GET availability requires an owner", async () => {
  const { createGithubRepoAvailabilityGetHandler } = await loadRoute();
  const handler = createGithubRepoAvailabilityGetHandler({
    requireUserId: async () => "user-123",
    getGithubToken: async () => "token",
    checkAvailability: async () => "available",
  });

  const response = await handler(
    new Request("http://localhost/api/github/repos/availability?name=widgets")
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    availability: "invalid",
    error: "Select a GitHub account",
  });
});

test("GET availability reports available and taken repositories", async () => {
  const { createGithubRepoAvailabilityGetHandler } = await loadRoute();
  const checks: Array<{ owner: string; name: string }> = [];
  const handler = createGithubRepoAvailabilityGetHandler({
    requireUserId: async () => "user-123",
    getGithubToken: async () => "token",
    checkAvailability: async (_token, owner, name) => {
      checks.push({ owner, name });
      return name === "taken" ? "taken" : "available";
    },
  });

  const available = await handler(
    new Request(
      "http://localhost/api/github/repos/availability?owner=acme&name=widgets"
    )
  );
  assert.equal(available.status, 200);
  assert.deepEqual(await available.json(), {
    availability: "available",
    owner: "acme",
    name: "widgets",
  });

  const taken = await handler(
    new Request(
      "http://localhost/api/github/repos/availability?owner=acme&name=taken"
    )
  );
  assert.equal(taken.status, 200);
  assert.deepEqual(await taken.json(), {
    availability: "taken",
    owner: "acme",
    name: "taken",
  });
  assert.deepEqual(checks, [
    { owner: "acme", name: "widgets" },
    { owner: "acme", name: "taken" },
  ]);
});

test("GET availability degrades GitHub rate and permission failures", async () => {
  const { createGithubRepoAvailabilityGetHandler } = await loadRoute();
  const handler = createGithubRepoAvailabilityGetHandler({
    requireUserId: async () => "user-123",
    getGithubToken: async () => "token",
    checkAvailability: async () => "unverified",
  });

  const response = await handler(
    new Request(
      "http://localhost/api/github/repos/availability?owner=acme&name=widgets"
    )
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    availability: "unverified",
    owner: "acme",
    name: "widgets",
  });
});
