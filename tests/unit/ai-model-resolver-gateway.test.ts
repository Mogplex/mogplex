import assert from "node:assert/strict";
import test from "node:test";
import { loadAiModelResolver } from "./helpers/ai-model-resolver-fixtures";

test("resolveUserLanguageModel prefers a user AI Gateway key over the platform gateway key", async () => {
  const { createResolveUserLanguageModel } = await loadAiModelResolver();
  const originalGatewayApiKey = process.env.AI_GATEWAY_API_KEY;
  process.env.AI_GATEWAY_API_KEY = "platform-gateway-key";

  try {
    const resolver = createResolveUserLanguageModel({
      getProviderKey: async (_userId, provider) =>
        provider === "ai_gateway" ? "user-gateway-key" : null,
      loadUserPlatformAccess: async () => ({
        allowPlatformAi: false,
      }),
      resolveGatewayModel: (apiKey, modelId) => ({ apiKey, modelId }) as never,
      resolveOpenAIModel: () => {
        throw new Error("resolveOpenAIModel should not be called");
      },
      resolveAnthropicModel: () => {
        throw new Error("resolveAnthropicModel should not be called");
      },
    });

    const resolved = await resolver("user-123", "openai/gpt-5.4", {
      gatewayFallbackModelIds: [
        "openai/gpt-5.4",
        "zai/glm-5.2-fast",
        "xai/grok-4.5",
      ],
    });
    assert.deepEqual(resolved.model, {
      apiKey: "user-gateway-key",
      modelId: "openai/gpt-5.4",
    });
    assert.deepEqual(resolved.providerOptions, {
      gateway: {
        user: "user-123",
        sort: "tps",
        models: ["zai/glm-5.2-fast"],
      },
    });
  } finally {
    if (originalGatewayApiKey === undefined) {
      delete process.env.AI_GATEWAY_API_KEY;
    } else {
      process.env.AI_GATEWAY_API_KEY = originalGatewayApiKey;
    }
  }
});

test("resolveUserLanguageModel falls back to direct provider keys when no AI Gateway key exists", async () => {
  const { createResolveUserLanguageModel } = await loadAiModelResolver();
  const originalGatewayApiKey = process.env.AI_GATEWAY_API_KEY;
  delete process.env.AI_GATEWAY_API_KEY;

  try {
    const resolver = createResolveUserLanguageModel({
      getProviderKey: async (_userId, provider) => {
        if (provider === "openai") return "user-openai-key";
        return null;
      },
      loadUserPlatformAccess: async () => ({
        allowPlatformAi: false,
      }),
      resolveGatewayModel: () => {
        throw new Error("resolveGatewayModel should not be called");
      },
      resolveOpenAIModel: (apiKey, modelId) => ({ apiKey, modelId }) as never,
      resolveAnthropicModel: () => {
        throw new Error("resolveAnthropicModel should not be called");
      },
    });

    const resolved = await resolver("user-123", "openai/gpt-5.4", {
      gatewayFallbackModelIds: ["zai/glm-5.2-fast"],
    });
    assert.deepEqual(resolved.model, {
      apiKey: "user-openai-key",
      modelId: "gpt-5.4",
    });
    assert.equal(resolved.providerOptions, undefined);
  } finally {
    if (originalGatewayApiKey === undefined) {
      delete process.env.AI_GATEWAY_API_KEY;
    } else {
      process.env.AI_GATEWAY_API_KEY = originalGatewayApiKey;
    }
  }
});

test("resolveUserLanguageModel filters gateway fallbacks through team capabilities and allowlist", async () => {
  const { createResolveUserLanguageModel } = await loadAiModelResolver();
  const originalGatewayApiKey = process.env.AI_GATEWAY_API_KEY;
  process.env.AI_GATEWAY_API_KEY = "platform-gateway-key";

  try {
    const resolver = createResolveUserLanguageModel({
      getProviderKey: async (_userId, provider) =>
        provider === "ai_gateway" ? "user-gateway-key" : null,
      loadUserPlatformAccess: async () => ({ allowPlatformAi: false }),
      resolveMemberCapabilities: async () =>
        new Set(["models.xai.*", "models.openai.*"]),
      loadTeamAllowlistState: async () => ({
        status: "restricted",
        models: ["xai/grok-4.5", "zai/glm-5.2-fast", "openai/gpt-5.4"],
      }),
      resolveGatewayModel: (apiKey, modelId) => ({ apiKey, modelId }) as never,
      resolveOpenAIModel: () => {
        throw new Error("resolveOpenAIModel should not be called");
      },
      resolveAnthropicModel: () => {
        throw new Error("resolveAnthropicModel should not be called");
      },
    });

    const resolved = await resolver("user-123", "xai/grok-4.5", {
      teamId: "team-123",
      gatewayFallbackModelIds: ["zai/glm-5.2-fast", "openai/gpt-5.4"],
    });

    assert.deepEqual(resolved.providerOptions, {
      gateway: {
        user: "user-123",
        sort: "tps",
        models: ["openai/gpt-5.4"],
      },
    });
  } finally {
    if (originalGatewayApiKey === undefined) {
      delete process.env.AI_GATEWAY_API_KEY;
    } else {
      process.env.AI_GATEWAY_API_KEY = originalGatewayApiKey;
    }
  }
});

test("resolveUserLanguageModel omits gateway fallbacks excluded by a team allowlist", async () => {
  const { createResolveUserLanguageModel } = await loadAiModelResolver();
  const originalGatewayApiKey = process.env.AI_GATEWAY_API_KEY;
  process.env.AI_GATEWAY_API_KEY = "platform-gateway-key";

  try {
    const resolver = createResolveUserLanguageModel({
      getProviderKey: async (_userId, provider) =>
        provider === "ai_gateway" ? "user-gateway-key" : null,
      loadUserPlatformAccess: async () => ({ allowPlatformAi: false }),
      resolveMemberCapabilities: async () => new Set(["models.*"]),
      loadTeamAllowlistState: async () => ({
        status: "restricted",
        models: ["xai/grok-4.5"],
      }),
      resolveGatewayModel: (apiKey, modelId) => ({ apiKey, modelId }) as never,
      resolveOpenAIModel: () => {
        throw new Error("resolveOpenAIModel should not be called");
      },
      resolveAnthropicModel: () => {
        throw new Error("resolveAnthropicModel should not be called");
      },
    });

    const resolved = await resolver("user-123", "xai/grok-4.5", {
      teamId: "team-123",
      gatewayFallbackModelIds: ["zai/glm-5.2-fast", "openai/gpt-5.4"],
    });

    assert.deepEqual(resolved.providerOptions, {
      gateway: { user: "user-123", sort: "tps" },
    });
  } finally {
    if (originalGatewayApiKey === undefined) {
      delete process.env.AI_GATEWAY_API_KEY;
    } else {
      process.env.AI_GATEWAY_API_KEY = originalGatewayApiKey;
    }
  }
});
