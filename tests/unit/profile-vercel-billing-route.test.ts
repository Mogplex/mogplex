import assert from "node:assert/strict";
import test from "node:test";

async function loadProfileVercelBillingRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/profile/vercel-billing/route");
}

function createPatchRequest(body: unknown) {
  return new Request("http://localhost/api/profile/vercel-billing", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("PATCH /api/profile/vercel-billing with { projectId: null } clears both columns", async () => {
  const { createProfileVercelBillingPatchHandler } =
    await loadProfileVercelBillingRoute();

  const updates: Array<{
    userId: string;
    updates: {
      default_vercel_project_id: string | null;
      default_vercel_team_id: string | null;
    };
  }> = [];

  const handler = createProfileVercelBillingPatchHandler({
    requireUserId: async () => "user-1",
    loadUserVercelCredentials: async () => {
      throw new Error(
        "loadUserVercelCredentials should not be called on clear"
      );
    },
    getVercelProjectDetails: async () => {
      throw new Error("getVercelProjectDetails should not be called on clear");
    },
    updateProfile: async (userId, patch) => {
      updates.push({ userId, updates: patch });
      return { error: null };
    },
  });

  const response = await handler(
    createPatchRequest({ projectId: null, teamId: null })
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    projectId: null,
    teamId: null,
    projectName: null,
  });
  assert.deepEqual(updates, [
    {
      userId: "user-1",
      updates: {
        default_vercel_project_id: null,
        default_vercel_team_id: null,
      },
    },
  ]);
});

test("PATCH /api/profile/vercel-billing rejects missing projectId with 400", async () => {
  const { createProfileVercelBillingPatchHandler } =
    await loadProfileVercelBillingRoute();

  const handler = createProfileVercelBillingPatchHandler({
    requireUserId: async () => "user-1",
    loadUserVercelCredentials: async () => {
      throw new Error("should not look up credentials for invalid payload");
    },
    getVercelProjectDetails: async () => {
      throw new Error("should not call Vercel for invalid payload");
    },
    updateProfile: async () => {
      throw new Error("should not clear defaults for invalid payload");
    },
  });

  const response = await handler(createPatchRequest({}));

  assert.equal(response.status, 400);
  const body = (await response.json()) as { error: string };
  assert.match(body.error, /projectId/);
});

test("PATCH /api/profile/vercel-billing rejects non-string projectId with 400", async () => {
  const { createProfileVercelBillingPatchHandler } =
    await loadProfileVercelBillingRoute();

  const handler = createProfileVercelBillingPatchHandler({
    requireUserId: async () => "user-1",
    loadUserVercelCredentials: async () => {
      throw new Error("should not look up credentials for invalid payload");
    },
    getVercelProjectDetails: async () => {
      throw new Error("should not call Vercel for invalid payload");
    },
    updateProfile: async () => {
      throw new Error("should not clear defaults for invalid payload");
    },
  });

  const response = await handler(createPatchRequest({ projectId: 123 }));

  assert.equal(response.status, 400);
  const body = (await response.json()) as { error: string };
  assert.match(body.error, /projectId/);
});

test("PATCH /api/profile/vercel-billing forwards PROJECT_NOT_FOUND as 404", async () => {
  const { createProfileVercelBillingPatchHandler } =
    await loadProfileVercelBillingRoute();

  const handler = createProfileVercelBillingPatchHandler({
    requireUserId: async () => "user-1",
    loadUserVercelCredentials: async () => ({
      userVercelToken: "vrc-token",
      userVercelTeamId: null,
      accountDefaultVercelProjectId: null,
      accountDefaultVercelTeamId: null,
    }),
    getVercelProjectDetails: async () => ({
      ok: false,
      error: { code: "PROJECT_NOT_FOUND", message: "missing", status: 404 },
    }),
    updateProfile: async () => {
      throw new Error("should not write profile when Vercel lookup fails");
    },
  });

  const response = await handler(
    createPatchRequest({ projectId: "prj_missing", teamId: null })
  );

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: "VERCEL_PROJECT_NOT_FOUND",
  });
});

test("PATCH /api/profile/vercel-billing forwards PROJECT_FORBIDDEN as 403", async () => {
  const { createProfileVercelBillingPatchHandler } =
    await loadProfileVercelBillingRoute();

  const handler = createProfileVercelBillingPatchHandler({
    requireUserId: async () => "user-1",
    loadUserVercelCredentials: async () => ({
      userVercelToken: "vrc-token",
      userVercelTeamId: null,
      accountDefaultVercelProjectId: null,
      accountDefaultVercelTeamId: null,
    }),
    getVercelProjectDetails: async () => ({
      ok: false,
      error: { code: "PROJECT_FORBIDDEN", message: "no access", status: 403 },
    }),
    updateProfile: async () => {
      throw new Error("should not write profile when Vercel lookup fails");
    },
  });

  const response = await handler(
    createPatchRequest({ projectId: "prj_x", teamId: null })
  );

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    error: "VERCEL_PROJECT_FORBIDDEN",
  });
});

test("PATCH /api/profile/vercel-billing returns 400 when Vercel token is missing", async () => {
  const { createProfileVercelBillingPatchHandler } =
    await loadProfileVercelBillingRoute();

  const handler = createProfileVercelBillingPatchHandler({
    requireUserId: async () => "user-1",
    loadUserVercelCredentials: async () => ({
      userVercelToken: null,
      userVercelTeamId: null,
      accountDefaultVercelProjectId: null,
      accountDefaultVercelTeamId: null,
    }),
    getVercelProjectDetails: async () => {
      throw new Error("should not call Vercel without a token");
    },
    updateProfile: async () => {
      throw new Error("should not update profile without a token");
    },
  });

  const response = await handler(
    createPatchRequest({ projectId: "prj_abc", teamId: null })
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "VERCEL_NOT_CONNECTED" });
});

test("PATCH /api/profile/vercel-billing scopes credential lookup to the authenticated user", async () => {
  const { createProfileVercelBillingPatchHandler } =
    await loadProfileVercelBillingRoute();

  const credentialCalls: string[] = [];

  const handler = createProfileVercelBillingPatchHandler({
    requireUserId: async () => "user-1",
    loadUserVercelCredentials: async (userId: string) => {
      credentialCalls.push(userId);
      return {
        userVercelToken: "vrc-token",
        userVercelTeamId: null,
        accountDefaultVercelProjectId: null,
        accountDefaultVercelTeamId: null,
      };
    },
    getVercelProjectDetails: async () => ({
      ok: true,
      data: { id: "prj_abc", name: "My Project", framework: null },
    }),
    updateProfile: async () => ({ error: null }),
  });

  const response = await handler(
    createPatchRequest({ projectId: "prj_abc", teamId: null })
  );

  assert.equal(response.status, 200);
  assert.deepEqual(credentialCalls, ["user-1"]);
});

test("PATCH /api/profile/vercel-billing forwards Vercel auth errors as 401", async () => {
  const { createProfileVercelBillingPatchHandler } =
    await loadProfileVercelBillingRoute();

  const handler = createProfileVercelBillingPatchHandler({
    requireUserId: async () => "user-1",
    loadUserVercelCredentials: async () => ({
      userVercelToken: "vrc-token",
      userVercelTeamId: null,
      accountDefaultVercelProjectId: null,
      accountDefaultVercelTeamId: null,
    }),
    getVercelProjectDetails: async () => ({
      ok: false,
      error: { code: "AUTH_INVALID", message: "bad token", status: 401 },
    }),
    updateProfile: async () => {
      throw new Error("should not write profile when Vercel lookup fails");
    },
  });

  const response = await handler(
    createPatchRequest({ projectId: "prj_abc", teamId: null })
  );

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "VERCEL_AUTH_INVALID" });
});

test("PATCH /api/profile/vercel-billing forwards Vercel team-forbidden errors as 403", async () => {
  const { createProfileVercelBillingPatchHandler } =
    await loadProfileVercelBillingRoute();

  const handler = createProfileVercelBillingPatchHandler({
    requireUserId: async () => "user-1",
    loadUserVercelCredentials: async () => ({
      userVercelToken: "vrc-token",
      userVercelTeamId: null,
      accountDefaultVercelProjectId: null,
      accountDefaultVercelTeamId: null,
    }),
    getVercelProjectDetails: async () => ({
      ok: false,
      error: { code: "TEAM_FORBIDDEN", message: "no access", status: 403 },
    }),
    updateProfile: async () => {
      throw new Error("should not write profile when Vercel lookup fails");
    },
  });

  const response = await handler(
    createPatchRequest({ projectId: "prj_abc", teamId: "team_x" })
  );

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    error: "VERCEL_PROJECT_FORBIDDEN",
  });
});

test("PATCH /api/profile/vercel-billing happy path writes both columns and returns projectName", async () => {
  const { createProfileVercelBillingPatchHandler } =
    await loadProfileVercelBillingRoute();

  const updateCalls: Array<{
    userId: string;
    patch: {
      default_vercel_project_id: string | null;
      default_vercel_team_id: string | null;
    };
  }> = [];
  let vercelProjectIdRequested: string | null = null;
  let vercelTokenUsed: string | null = null;
  let vercelTeamIdUsed: string | null | undefined;

  const handler = createProfileVercelBillingPatchHandler({
    requireUserId: async () => "user-42",
    loadUserVercelCredentials: async () => ({
      userVercelToken: "vrc-token",
      userVercelTeamId: null,
      accountDefaultVercelProjectId: null,
      accountDefaultVercelTeamId: null,
    }),
    getVercelProjectDetails: async (input) => {
      vercelProjectIdRequested = input.projectId;
      vercelTokenUsed =
        "vercelToken" in input ? (input.vercelToken ?? null) : null;
      vercelTeamIdUsed = input.teamId;
      return {
        ok: true,
        data: {
          id: input.projectId,
          name: "Production",
          framework: "nextjs",
        },
      };
    },
    updateProfile: async (userId, patch) => {
      updateCalls.push({ userId, patch });
      return { error: null };
    },
  });

  const response = await handler(
    createPatchRequest({ projectId: "prj_abc", teamId: "team_x" })
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    projectId: "prj_abc",
    teamId: "team_x",
    projectName: "Production",
  });
  assert.equal(vercelProjectIdRequested, "prj_abc");
  assert.equal(vercelTokenUsed, "vrc-token");
  assert.equal(vercelTeamIdUsed, "team_x");
  assert.deepEqual(updateCalls, [
    {
      userId: "user-42",
      patch: {
        default_vercel_project_id: "prj_abc",
        default_vercel_team_id: "team_x",
      },
    },
  ]);
});
