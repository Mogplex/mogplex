import assert from "node:assert/strict";
import test from "node:test";

async function loadSlackInstallationRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/integrations/slack/installations/[teamId]/route");
}

const baseInstallation = {
  id: "install-1",
  team_id: "T1",
  team_name: "Mogplex",
  installed_by_user_id: "user-123",
  bot_user_id: "UBOT",
  vault_bot_token_id: "vault-secret-1",
  scopes: ["chat:write"],
  authed_user_slack_id: "USLACK-INSTALLER",
  repo_agent_enabled: true,
  allowed_slack_user_ids: null,
  monthly_repo_run_limit: null,
  created_at: "2026-05-11T00:00:00Z",
  updated_at: "2026-05-11T00:00:00Z",
};

function createPatchRequest(body: unknown) {
  return new Request(
    "http://localhost/api/integrations/slack/installations/T1",
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
}

test("PATCH /slack installation rejects bodies without policy fields", async () => {
  const { createSlackInstallationPatchHandler } =
    await loadSlackInstallationRoute();
  let updateCalled = false;

  const handler = createSlackInstallationPatchHandler({
    requireUserId: async () => "user-123",
    deleteSlackInstallation: async () => undefined,
    updateSlackInstallationPolicy: async () => {
      updateCalled = true;
      return baseInstallation;
    },
  });

  const response = await handler(createPatchRequest({ ignored: true }), {
    params: Promise.resolve({ teamId: "T1" }),
  });

  assert.equal(response.status, 400);
  assert.equal(updateCalled, false);
});

test("PATCH /slack installation preserves an explicit empty allowlist", async () => {
  const { createSlackInstallationPatchHandler } =
    await loadSlackInstallationRoute();
  let update: {
    teamId: string;
    userId: string;
    allowedSlackUserIds?: string[] | null;
  } | null = null;

  const handler = createSlackInstallationPatchHandler({
    requireUserId: async () => "user-123",
    deleteSlackInstallation: async () => undefined,
    updateSlackInstallationPolicy: async (input) => {
      update = input;
      return {
        ...baseInstallation,
        allowed_slack_user_ids: input.allowedSlackUserIds ?? null,
      };
    },
  });

  const response = await handler(
    createPatchRequest({ allowedSlackUserIds: [] }),
    {
      params: Promise.resolve({ teamId: "T1" }),
    }
  );

  assert.equal(response.status, 200);
  assert.deepEqual(update, {
    teamId: "T1",
    userId: "user-123",
    allowedSlackUserIds: [],
  });
  assert.deepEqual(
    (await response.json()).installation.allowedSlackUserIds,
    []
  );
});

test("PATCH /slack installation reports the allowlist entry limit", async () => {
  const { createSlackInstallationPatchHandler } =
    await loadSlackInstallationRoute();
  let updateCalled = false;

  const handler = createSlackInstallationPatchHandler({
    requireUserId: async () => "user-123",
    deleteSlackInstallation: async () => undefined,
    updateSlackInstallationPolicy: async () => {
      updateCalled = true;
      return baseInstallation;
    },
  });

  const response = await handler(
    createPatchRequest({
      allowedSlackUserIds: Array.from(
        { length: 101 },
        (_, index) => `U${index}`
      ),
    }),
    {
      params: Promise.resolve({ teamId: "T1" }),
    }
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "allowedSlackUserIds must contain at most 100 entries",
  });
  assert.equal(updateCalled, false);
});

test("PATCH /slack installation applies the allowlist limit before trimming blanks", async () => {
  const { createSlackInstallationPatchHandler } =
    await loadSlackInstallationRoute();
  let updateCalled = false;

  const handler = createSlackInstallationPatchHandler({
    requireUserId: async () => "user-123",
    deleteSlackInstallation: async () => undefined,
    updateSlackInstallationPolicy: async () => {
      updateCalled = true;
      return baseInstallation;
    },
  });

  const response = await handler(
    createPatchRequest({
      allowedSlackUserIds: Array.from({ length: 101 }, () => " "),
    }),
    {
      params: Promise.resolve({ teamId: "T1" }),
    }
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "allowedSlackUserIds must contain at most 100 entries",
  });
  assert.equal(updateCalled, false);
});
