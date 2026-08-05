import assert from "node:assert/strict";
import test from "node:test";

async function loadProfileVercelBillingRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/profile/vercel-billing/route");
}

function createPatchRequest(body: unknown) {
  return new Request("https://example.com/api/profile/vercel-billing", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("PATCH /api/profile/vercel-billing still clears stale defaults", async () => {
  const { createProfileVercelBillingPatchHandler } =
    await loadProfileVercelBillingRoute();
  const updates: Array<Record<string, string | null>> = [];
  const handler = createProfileVercelBillingPatchHandler({
    requireUserId: async () => "user-1",
    updateProfile: async (_userId, patch) => {
      updates.push(patch);
      return { error: null };
    },
  });

  const response = await handler(
    createPatchRequest({ projectId: null, teamId: null })
  );

  assert.equal(response.status, 200);
  assert.deepEqual(updates, [
    {
      default_vercel_project_id: null,
      default_vercel_team_id: null,
    },
  ]);
});

test("PATCH /api/profile/vercel-billing rejects new personal project configuration", async () => {
  const { createProfileVercelBillingPatchHandler } =
    await loadProfileVercelBillingRoute();
  const handler = createProfileVercelBillingPatchHandler({
    requireUserId: async () => "user-1",
    loadUserVercelCredentials: async () => {
      throw new Error("disabled configuration must not load credentials");
    },
  });

  const response = await handler(
    createPatchRequest({ projectId: "prj_123", teamId: "team_123" })
  );

  assert.equal(response.status, 501);
  assert.deepEqual(await response.json(), {
    error: "VERCEL_INTEGRATION_REQUIRED",
    message:
      "User-owned Vercel billing requires an API-capable Vercel integration and is not available.",
  });
});
