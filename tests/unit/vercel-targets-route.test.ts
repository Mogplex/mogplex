import assert from "node:assert/strict";
import test from "node:test";

async function loadVercelTargetsRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/vercel/targets/route");
}

const integrationRequired = {
  error: "VERCEL_INTEGRATION_REQUIRED",
  message:
    "Vercel project actions require an API-capable Vercel integration and are not available.",
};

test("GET /api/vercel/targets rejects unavailable personal Vercel API access", async () => {
  const { createVercelTargetsGetHandler } = await loadVercelTargetsRoute();
  const handler = createVercelTargetsGetHandler({
    getUserCredentials: async () => {
      throw new Error("disabled target lookup must not load credentials");
    },
  });

  const response = await handler(
    new Request("https://example.com/api/vercel/targets")
  );

  assert.equal(response.status, 501);
  assert.deepEqual(await response.json(), integrationRequired);
});

test("POST /api/vercel/targets rejects unavailable project creation", async () => {
  const { createVercelTargetsPostHandler } = await loadVercelTargetsRoute();
  const handler = createVercelTargetsPostHandler({
    getUserCredentials: async () => {
      throw new Error("disabled project creation must not load credentials");
    },
  });

  const response = await handler(
    new Request("https://example.com/api/vercel/targets", {
      method: "POST",
      body: JSON.stringify({ name: "must-not-create" }),
    })
  );

  assert.equal(response.status, 501);
  assert.deepEqual(await response.json(), integrationRequired);
});
