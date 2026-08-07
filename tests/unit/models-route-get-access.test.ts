import assert from "node:assert/strict";
import test from "node:test";
import {
  loadModelsRoute,
  catalogRow,
  autoEnableOn,
  allProviderAccess,
} from "./helpers/models-route-fixtures";

test("GET /api/models filters out unreachable providers from the dropdown payload", async () => {
  const { createModelsGetHandler } = await loadModelsRoute();

  const handler = createModelsGetHandler({
    getUserId: async () => "user-123",
    loadProfileModelSettings: autoEnableOn,
    listAvailableModels: async () => ({ data: [], error: null }),
    listAllModels: async () => ({
      data: [
        catalogRow({
          id: "openai/gpt-5-mini",
          provider: "openai",
          name: "GPT-5 mini",
        }),
        catalogRow({
          id: "moonshotai/kimi-k2.6",
          provider: "moonshotai",
          name: "Kimi K2.6",
        }),
        catalogRow({
          id: "openrouter/deepseek/deepseek-v4-pro",
          provider: "openrouter",
          name: "DeepSeek v4 Pro (OpenRouter)",
        }),
      ],
      error: null,
    }),
    listUserModelPreferences: async () => ({ data: [], error: null }),
    // User has gateway access but no OpenRouter key.
    loadUserProviderAccess: async () => ({
      data: {
        hasGateway: true,
        hasOpenAi: false,
        hasAnthropic: false,
        hasOpenRouter: false,
      },
      error: null,
    }),
  });

  const response = await handler();
  const payload = await response.json();

  assert.equal(response.status, 200);
  // Dropdown only sees reachable models — OpenRouter row is hidden.
  assert.deepEqual(
    [...payload.models].map((model: { id: string }) => model.id).sort(),
    ["moonshotai/kimi-k2.6", "openai/gpt-5-mini"]
  );
  // Settings catalog still shows every model so the user can enable
  // OpenRouter integration later.
  assert.deepEqual(
    [...payload.catalog].map((model: { id: string }) => model.id).sort(),
    [
      "moonshotai/kimi-k2.6",
      "openai/gpt-5-mini",
      "openrouter/deepseek/deepseek-v4-pro",
    ]
  );
});

test("GET /api/models applies active team capabilities and model allowlist", async () => {
  const { createModelsGetHandler } = await loadModelsRoute();
  let providerAccessTeamId: string | null = null;
  let capabilitiesTeamId: string | null | undefined;
  let allowlistTeamId = "";

  const handler = createModelsGetHandler({
    getUserId: async () => "user-123",
    loadProfileModelSettings: autoEnableOn,
    listAvailableModels: async () => ({ data: [], error: null }),
    listAllModels: async () => ({
      data: [
        catalogRow({
          id: "openai/gpt-5-mini",
          provider: "openai",
          name: "GPT-5 mini",
        }),
        catalogRow({
          id: "anthropic/claude-sonnet-5",
          provider: "anthropic",
          name: "Claude Sonnet 5",
        }),
      ],
      error: null,
    }),
    listUserModelPreferences: async () => ({ data: [], error: null }),
    loadUserProviderAccess: async (_userId, teamId) => {
      providerAccessTeamId = teamId;
      return allProviderAccess();
    },
    resolveMemberCapabilities: async (_userId, teamId) => {
      capabilitiesTeamId = teamId;
      return new Set(["models.openai.*"]);
    },
    loadTeamAllowlistState: async (teamId) => {
      allowlistTeamId = teamId;
      return {
        status: "restricted",
        models: ["openai/gpt-5-mini", "anthropic/claude-sonnet-5"],
      };
    },
  });

  const response = await handler(
    new Request("http://localhost/api/models", {
      headers: { "x-mogplex-team-id": "00000000-0000-4000-8000-000000000123" },
    })
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(providerAccessTeamId, "00000000-0000-4000-8000-000000000123");
  assert.equal(capabilitiesTeamId, "00000000-0000-4000-8000-000000000123");
  assert.equal(allowlistTeamId, "00000000-0000-4000-8000-000000000123");
  assert.deepEqual(
    payload.models.map((model: { id: string }) => model.id),
    ["openai/gpt-5-mini"]
  );
  assert.deepEqual(
    payload.catalog.map((model: { id: string }) => model.id),
    ["openai/gpt-5-mini", "anthropic/claude-sonnet-5"]
  );
});

test("GET /api/models returns 500 when the team allowlist cannot be read (does not offer forbidden models)", async () => {
  const { createModelsGetHandler } = await loadModelsRoute();

  const handler = createModelsGetHandler({
    getUserId: async () => "user-123",
    loadProfileModelSettings: autoEnableOn,
    listAvailableModels: async () => ({ data: [], error: null }),
    listAllModels: async () => ({
      data: [
        catalogRow({
          id: "openai/gpt-5-mini",
          provider: "openai",
          name: "GPT-5 mini",
        }),
      ],
      error: null,
    }),
    listUserModelPreferences: async () => ({ data: [], error: null }),
    loadUserProviderAccess: allProviderAccess,
    resolveMemberCapabilities: async () => new Set(["models.*"]),
    loadTeamAllowlistState: async () => ({
      status: "unknown",
      reason: "read failed",
    }),
  });

  const response = await handler(
    new Request("http://localhost/api/models", {
      headers: { "x-mogplex-team-id": "00000000-0000-4000-8000-000000000123" },
    })
  );

  // Not a 200 with an unfiltered picker: offering models the team forbids
  // surfaces a transient read error as a permissions error at invocation time.
  // 503 rather than 500 so this agrees with the other two surfaces that map
  // the same condition — the failure is transient, and a 500 reads as a bug.
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Retry-After"), "5");

  const body = await response.json();
  // A machine-readable marker so a client can eventually distinguish this from
  // a generic failure (#769). No catalog: fetchJsonObject discards non-ok
  // bodies, so shipping one would be pure cost on a degraded path.
  assert.equal(body.allowlistUnavailable, true);
  assert.equal("catalog" in body, false);
});

test("GET /api/models returns 500 when provider access lookup fails (does not silently empty the picker)", async () => {
  const { createModelsGetHandler } = await loadModelsRoute();

  const handler = createModelsGetHandler({
    getUserId: async () => "user-123",
    loadProfileModelSettings: autoEnableOn,
    listAvailableModels: async () => ({ data: [], error: null }),
    listAllModels: async () => ({
      data: [
        catalogRow({
          id: "openai/gpt-5-mini",
          provider: "openai",
          name: "GPT-5 mini",
        }),
      ],
      error: null,
    }),
    listUserModelPreferences: async () => ({ data: [], error: null }),
    loadUserProviderAccess: async () => ({
      data: null,
      error: { message: "vault unavailable" },
    }),
  });

  const response = await handler();
  const payload = await response.json();

  assert.equal(response.status, 500);
  assert.equal(payload.error, "vault unavailable");
});
