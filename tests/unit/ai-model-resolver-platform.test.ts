import assert from "node:assert/strict";
import test from "node:test";
import { loadAiModelResolver } from "./helpers/ai-model-resolver-fixtures";

test("resolveUserLanguageModel can force a provider object for platform AI Gateway access", async () => {
  const { createResolveUserLanguageModel } = await loadAiModelResolver();
  const originalGatewayApiKey = process.env.AI_GATEWAY_API_KEY;
  process.env.AI_GATEWAY_API_KEY = "platform-gateway-key";
  const providerFetch = (() =>
    Promise.reject(new Error("unused"))) as typeof fetch;

  try {
    const resolver = createResolveUserLanguageModel({
      getProviderKey: async () => null,
      loadUserPlatformAccess: async () => ({
        allowPlatformAi: true,
      }),
      resolveGatewayModel: (apiKey, modelId, options) =>
        ({
          apiKey,
          modelId,
          fetch: options?.fetch,
        }) as never,
      resolveOpenAIModel: () => {
        throw new Error("resolveOpenAIModel should not be called");
      },
      resolveAnthropicModel: () => {
        throw new Error("resolveAnthropicModel should not be called");
      },
    });

    const resolved = await resolver("user-123", "openai/gpt-5.4", {
      providerFetch,
      preferGatewayProviderObject: true,
    });
    assert.deepEqual(resolved.model, {
      apiKey: "platform-gateway-key",
      modelId: "openai/gpt-5.4",
      fetch: providerFetch,
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

test("resolveUserLanguageModel blocks platform AI Gateway fallback for non-allowlisted users", async () => {
  const { createResolveUserLanguageModel } = await loadAiModelResolver();
  const originalGatewayApiKey = process.env.AI_GATEWAY_API_KEY;
  process.env.AI_GATEWAY_API_KEY = "platform-gateway-key";

  try {
    const resolver = createResolveUserLanguageModel({
      getProviderKey: async () => null,
      loadUserPlatformAccess: async () => ({
        allowPlatformAi: false,
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
    });

    await assert.rejects(
      () => resolver("user-123", "openai/gpt-5.4"),
      /Hosted AI requires a positive billing balance/
    );
  } finally {
    if (originalGatewayApiKey === undefined) {
      delete process.env.AI_GATEWAY_API_KEY;
    } else {
      process.env.AI_GATEWAY_API_KEY = originalGatewayApiKey;
    }
  }
});

test("resolveUserLanguageModel pins moonshotai/* gateway calls to fireworks", async () => {
  const { createResolveUserLanguageModel } = await loadAiModelResolver();
  const originalGatewayApiKey = process.env.AI_GATEWAY_API_KEY;
  process.env.AI_GATEWAY_API_KEY = "platform-gateway-key";

  try {
    const resolver = createResolveUserLanguageModel({
      getProviderKey: async () => null,
      loadUserPlatformAccess: async () => ({ allowPlatformAi: true }),
      resolveGatewayModel: () => {
        throw new Error("resolveGatewayModel should not be called");
      },
      resolveOpenAIModel: () => {
        throw new Error("resolveOpenAIModel should not be called");
      },
      resolveAnthropicModel: () => {
        throw new Error("resolveAnthropicModel should not be called");
      },
    });

    const resolved = await resolver("user-123", "moonshotai/kimi-k2.6");
    assert.equal(resolved.model, "moonshotai/kimi-k2.6");
    assert.deepEqual(resolved.providerOptions, {
      gateway: { user: "user-123", sort: "tps", order: ["fireworks"] },
    });
  } finally {
    if (originalGatewayApiKey === undefined) {
      delete process.env.AI_GATEWAY_API_KEY;
    } else {
      process.env.AI_GATEWAY_API_KEY = originalGatewayApiKey;
    }
  }
});
