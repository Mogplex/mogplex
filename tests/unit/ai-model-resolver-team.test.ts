import assert from "node:assert/strict";
import test from "node:test";
import { loadAiModelResolver } from "./helpers/ai-model-resolver-fixtures";

test("resolveUserLanguageModel denies a model when the team role lacks the capability", async () => {
  const { createResolveUserLanguageModel } = await loadAiModelResolver();
  delete process.env.AI_GATEWAY_API_KEY;
  const audits: unknown[] = [];
  const resolver = createResolveUserLanguageModel({
    getProviderKey: async () => "irrelevant",
    loadUserPlatformAccess: async () => ({ allowPlatformAi: false }),
    resolveMemberCapabilities: async () => new Set(["tools.web_search"]),
    loadTeamAllowlistState: async () => ({ status: "unrestricted" }),
    resolveGatewayModel: () => {
      throw new Error("resolveGatewayModel should not be called");
    },
    resolveOpenAIModel: () => {
      throw new Error("resolveOpenAIModel should not be called");
    },
    resolveAnthropicModel: () => {
      throw new Error("resolveAnthropicModel should not be called");
    },
    resolveOpenRouterModel: () => {
      throw new Error("resolveOpenRouterModel should not be called");
    },
    recordTeamAuditEvent: async (input) => {
      audits.push(input);
      return { ok: true };
    },
  });
  await assert.rejects(
    () => resolver("user-1", "openai/gpt-5", { teamId: "team-1" }),
    /not enabled for your team role/
  );
  assert.deepEqual(audits, [
    {
      productTeamId: "team-1",
      actorUserId: "user-1",
      action: "model.denied",
      decisionCode: "capability_denied",
      targetType: "model",
      targetId: "openai/gpt-5",
      payload: { required_capability: "models.openai.gpt-5" },
    },
  ]);
});

test("resolveUserLanguageModel denies a model when the team allowlist cannot be read", async () => {
  const { createResolveUserLanguageModel } = await loadAiModelResolver();
  delete process.env.AI_GATEWAY_API_KEY;
  const audits: unknown[] = [];
  const resolver = createResolveUserLanguageModel({
    getProviderKey: async () => "irrelevant",
    loadUserPlatformAccess: async () => ({ allowPlatformAi: false }),
    resolveMemberCapabilities: async () => new Set(["*"]),
    loadTeamAllowlistState: async () => ({
      status: "unknown",
      reason: "read failed",
    }),
    resolveGatewayModel: () => {
      throw new Error("resolveGatewayModel should not be called");
    },
    resolveOpenAIModel: () => {
      throw new Error("resolveOpenAIModel should not be called");
    },
    resolveAnthropicModel: () => {
      throw new Error("resolveAnthropicModel should not be called");
    },
    resolveOpenRouterModel: () => {
      throw new Error("resolveOpenRouterModel should not be called");
    },
    recordTeamAuditEvent: async (input) => {
      audits.push(input);
      return { ok: true };
    },
  });
  await assert.rejects(
    () => resolver("user-1", "openai/gpt-5", { teamId: "team-1" }),
    /Couldn't verify the team's model allowlist/
  );
  // A distinct decision code from model_not_in_allowlist: an admin reading the
  // audit log needs to tell "policy said no" from "we could not ask".
  assert.deepEqual(audits, [
    {
      productTeamId: "team-1",
      actorUserId: "user-1",
      action: "model.denied",
      decisionCode: "allowlist_unavailable",
      targetType: "model",
      targetId: "openai/gpt-5",
      // No raw Postgres text — that stays server-side — but the row does say
      // it is a throttled sample, so an admin does not read one denial as the
      // only denial.
      payload: {
        throttled: true,
        throttle_window_ms: 60_000,
        suppressed_since_last_in_process: 0,
      },
    },
  ]);
});

test("resolveUserLanguageModel throttles repeated allowlist-unavailable audits", async () => {
  // Every denied call used to write an audit row back to the same Supabase
  // instance whose read had just failed — the write least likely to succeed at
  // that moment — so a sustained outage amplified load against the failing
  // dependency. One row per (team, cause) per window is enough for an admin to
  // see denials are happening and why.
  const { createResolveUserLanguageModel } = await loadAiModelResolver();
  const { __resetAllowlistFailureLogForTests } =
    await import("../../lib/team-capabilities");
  __resetAllowlistFailureLogForTests();
  delete process.env.AI_GATEWAY_API_KEY;

  const audits: unknown[] = [];
  const resolver = createResolveUserLanguageModel({
    getProviderKey: async () => "irrelevant",
    loadUserPlatformAccess: async () => ({ allowPlatformAi: false }),
    resolveMemberCapabilities: async () => new Set(["*"]),
    loadTeamAllowlistState: async () => ({
      status: "unknown",
      reason: "connection reset",
    }),
    resolveGatewayModel: () => {
      throw new Error("resolveGatewayModel should not be called");
    },
    resolveOpenAIModel: () => {
      throw new Error("resolveOpenAIModel should not be called");
    },
    resolveAnthropicModel: () => {
      throw new Error("resolveAnthropicModel should not be called");
    },
    resolveOpenRouterModel: () => {
      throw new Error("resolveOpenRouterModel should not be called");
    },
    recordTeamAuditEvent: async (input) => {
      audits.push(input);
      return { ok: true };
    },
  });

  for (let call = 0; call < 3; call++) {
    await assert.rejects(
      () => resolver("user-1", "openai/gpt-5", { teamId: "team-throttle" }),
      /Couldn't verify the team's model allowlist/
    );
  }

  // All three calls still denied — throttling the record must never soften the
  // gate, only the bookkeeping.
  assert.equal(audits.length, 1);
});

test("resolveUserLanguageModel ignores an unreadable allowlist in solo scope", async () => {
  const { createResolveUserLanguageModel } = await loadAiModelResolver();
  delete process.env.AI_GATEWAY_API_KEY;
  const resolver = createResolveUserLanguageModel({
    getProviderKey: async (_userId, provider) =>
      provider === "openai" ? "personal-key" : null,
    loadUserPlatformAccess: async () => ({ allowPlatformAi: false }),
    loadTeamAllowlistState: async () => {
      throw new Error("solo scope must not read a team allowlist");
    },
    resolveGatewayModel: () => {
      throw new Error("resolveGatewayModel should not be called");
    },
    resolveOpenAIModel: (apiKey, modelId) => ({ apiKey, modelId }) as never,
    resolveAnthropicModel: () => {
      throw new Error("unused");
    },
    resolveOpenRouterModel: () => {
      throw new Error("unused");
    },
  });
  // Failing closed applies to team scope only — a solo user is not governed by
  // any allowlist, so there is nothing to fail closed on.
  const resolved = await resolver("user-1", "openai/gpt-5");
  assert.deepEqual(resolved.model, {
    apiKey: "personal-key",
    modelId: "gpt-5",
  });
});

test("resolveUserLanguageModel denies a model when the team allowlist excludes it", async () => {
  const { createResolveUserLanguageModel } = await loadAiModelResolver();
  delete process.env.AI_GATEWAY_API_KEY;
  const audits: unknown[] = [];
  const resolver = createResolveUserLanguageModel({
    getProviderKey: async () => "irrelevant",
    loadUserPlatformAccess: async () => ({ allowPlatformAi: false }),
    resolveMemberCapabilities: async () => new Set(["*"]),
    loadTeamAllowlistState: async () => ({
      status: "restricted",
      models: ["anthropic/claude-sonnet-4-6"],
    }),
    resolveGatewayModel: () => {
      throw new Error("resolveGatewayModel should not be called");
    },
    resolveOpenAIModel: () => {
      throw new Error("resolveOpenAIModel should not be called");
    },
    resolveAnthropicModel: () => {
      throw new Error("resolveAnthropicModel should not be called");
    },
    resolveOpenRouterModel: () => {
      throw new Error("resolveOpenRouterModel should not be called");
    },
    recordTeamAuditEvent: async (input) => {
      audits.push(input);
      return { ok: true };
    },
  });
  await assert.rejects(
    () => resolver("user-1", "openai/gpt-5", { teamId: "team-1" }),
    /not on the team's model allowlist/
  );
  assert.deepEqual(audits, [
    {
      productTeamId: "team-1",
      actorUserId: "user-1",
      action: "model.denied",
      decisionCode: "model_not_in_allowlist",
      targetType: "model",
      targetId: "openai/gpt-5",
      payload: { allowlist_size: 1 },
    },
  ]);
});

test("resolveUserLanguageModel admits an allowlisted model under team scope", async () => {
  const { createResolveUserLanguageModel } = await loadAiModelResolver();
  delete process.env.AI_GATEWAY_API_KEY;
  const resolver = createResolveUserLanguageModel({
    getProviderKey: async (_userId, provider, teamId) => {
      // Test the scope-aware key wiring: the openai call gets teamId="team-1".
      if (provider === "openai" && teamId === "team-1") return "team-key";
      return null;
    },
    loadUserPlatformAccess: async () => ({ allowPlatformAi: false }),
    resolveMemberCapabilities: async () => new Set(["*"]),
    loadTeamAllowlistState: async () => ({
      status: "restricted",
      models: ["openai/gpt-5"],
    }),
    resolveGatewayModel: () => {
      throw new Error("resolveGatewayModel should not be called");
    },
    resolveOpenAIModel: (apiKey, modelId) => ({ apiKey, modelId }) as never,
    resolveAnthropicModel: () => {
      throw new Error("resolveAnthropicModel should not be called");
    },
    resolveOpenRouterModel: () => {
      throw new Error("resolveOpenRouterModel should not be called");
    },
  });
  const resolved = await resolver("user-1", "openai/gpt-5", {
    teamId: "team-1",
  });
  assert.deepEqual(resolved.model, { apiKey: "team-key", modelId: "gpt-5" });
});

test("resolveUserLanguageModel honors caller-supplied capabilities + allowlist (no dep round-trips)", async () => {
  const { createResolveUserLanguageModel } = await loadAiModelResolver();
  delete process.env.AI_GATEWAY_API_KEY;
  const resolver = createResolveUserLanguageModel({
    getProviderKey: async (_userId, provider) =>
      provider === "openai" ? "k" : null,
    loadUserPlatformAccess: async () => ({ allowPlatformAi: false }),
    resolveMemberCapabilities: async () => {
      throw new Error("dep should not be called when caller supplies caps");
    },
    loadTeamAllowlistState: async () => {
      throw new Error(
        "dep should not be called when caller supplies allowlist"
      );
    },
    resolveGatewayModel: () => {
      throw new Error("resolveGatewayModel should not be called");
    },
    resolveOpenAIModel: (apiKey, modelId) => ({ apiKey, modelId }) as never,
    resolveAnthropicModel: () => {
      throw new Error("unused");
    },
    resolveOpenRouterModel: () => {
      throw new Error("unused");
    },
  });
  const resolved = await resolver("user-1", "openai/gpt-5", {
    teamId: "team-1",
    capabilities: new Set(["models.*"]),
    allowlistState: { status: "unrestricted" },
  });
  assert.deepEqual(resolved.model, { apiKey: "k", modelId: "gpt-5" });
});
