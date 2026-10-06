import assert from "node:assert/strict";
import test from "node:test";
import { NextResponse } from "next/server";

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
  assert.deepEqual(await response.json(), {
    projectId: null,
    teamId: null,
    projectName: null,
  });
});

test("clearing stale Vercel defaults requires authentication", async () => {
  const { createProfileVercelBillingPatchHandler } =
    await loadProfileVercelBillingRoute();
  const handler = createProfileVercelBillingPatchHandler({
    requireUserId: async () =>
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    updateProfile: async () => {
      throw new Error("unauthenticated requests must not update profiles");
    },
  });
  assert.equal(
    (await handler(createPatchRequest({ projectId: null }))).status,
    401
  );
});

test("invalid clear requests cannot erase saved defaults", async () => {
  const { createProfileVercelBillingPatchHandler } =
    await loadProfileVercelBillingRoute();
  const handler = createProfileVercelBillingPatchHandler({
    requireUserId: async () => "user-1",
    updateProfile: async () => {
      throw new Error("invalid requests must not update profiles");
    },
  });
  for (const body of [null, [], {}, { projectId: " " }, { projectId: 123 }]) {
    assert.equal((await handler(createPatchRequest(body))).status, 400);
  }
});

test("failed default clearing does not report success", async () => {
  const { createProfileVercelBillingPatchHandler } =
    await loadProfileVercelBillingRoute();
  const handler = createProfileVercelBillingPatchHandler({
    requireUserId: async () => "user-1",
    updateProfile: async (userId) => {
      assert.equal(userId, "user-1");
      return { error: { message: "Update failed" } };
    },
  });
  assert.equal(
    (await handler(createPatchRequest({ projectId: null }))).status,
    500
  );
});

test("PATCH /api/profile/vercel-billing rejects new personal project configuration", async () => {
  const { createProfileVercelBillingPatchHandler } =
    await loadProfileVercelBillingRoute();
  const handler = createProfileVercelBillingPatchHandler({
    requireUserId: async () => "user-1",
    updateProfile: async () => {
      throw new Error("unsupported configuration must not update the profile");
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
