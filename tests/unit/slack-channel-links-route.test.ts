import assert from "node:assert/strict";
import test from "node:test";

async function loadSlackChannelLinksRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/integrations/slack/installations/[teamId]/links/route");
}

async function loadSlackChannelLinkRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/integrations/slack/installations/[teamId]/links/[linkId]/route");
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
  created_at: "2026-05-11T00:00:00Z",
  updated_at: "2026-05-11T00:00:00Z",
};

function createPostRequest(body: unknown) {
  return new Request(
    "http://localhost/api/integrations/slack/installations/T1/links",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
}

test("POST /slack installation links rejects repos outside the current user", async () => {
  const { createSlackChannelLinksPostHandler } =
    await loadSlackChannelLinksRoute();
  let createCalled = false;

  const handler = createSlackChannelLinksPostHandler({
    requireUserId: async () => "user-123",
    getSlackInstallationByTeamId: async () => baseInstallation,
    getOwnedRepo: async () => null,
    listSlackChannelLinks: async () => [],
    createSlackChannelLink: async () => {
      createCalled = true;
      throw new Error("should not create a link for an unowned repo");
    },
  });

  const response = await handler(
    createPostRequest({
      channelId: "C1",
      channelName: "ops",
      repoId: "00000000-0000-4000-8000-000000000001",
    }),
    { params: Promise.resolve({ teamId: "T1" }) }
  );

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "repo_not_found" });
  assert.equal(createCalled, false);
});

test("POST /slack installation links maps Postgres unique violations to 409 by code", async () => {
  const { createSlackChannelLinksPostHandler } =
    await loadSlackChannelLinksRoute();

  const handler = createSlackChannelLinksPostHandler({
    requireUserId: async () => "user-123",
    getSlackInstallationByTeamId: async () => baseInstallation,
    getOwnedRepo: async <T = { id: string }>() =>
      ({ id: "00000000-0000-4000-8000-000000000001" }) as T,
    listSlackChannelLinks: async () => [],
    createSlackChannelLink: async () => {
      const error = new Error("duplicate key") as Error & { code: string };
      error.code = "23505";
      throw error;
    },
  });

  const response = await handler(
    createPostRequest({
      channelId: "C1",
      repoId: "00000000-0000-4000-8000-000000000001",
    }),
    { params: Promise.resolve({ teamId: "T1" }) }
  );

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: "Channel already linked" });
});

test("DELETE /slack installation links scopes deletion to the link creator", async () => {
  const { createSlackChannelLinkDeleteHandler } =
    await loadSlackChannelLinkRoute();
  let deleted: {
    linkId: string;
    installationId: string;
    createdByUserId: string;
  } | null = null;

  const handler = createSlackChannelLinkDeleteHandler({
    requireUserId: async () => "user-123",
    getSlackInstallationByTeamId: async () => baseInstallation,
    deleteSlackChannelLink: async (input) => {
      deleted = input;
    },
  });

  const response = await handler(
    new Request(
      "http://localhost/api/integrations/slack/installations/T1/links/link-1",
      { method: "DELETE" }
    ),
    { params: Promise.resolve({ teamId: "T1", linkId: "link-1" }) }
  );

  assert.equal(response.status, 200);
  assert.deepEqual(deleted, {
    linkId: "link-1",
    installationId: "install-1",
    createdByUserId: "user-123",
  });
});
