import assert from "node:assert/strict";
import test from "node:test";
import { loadAiModelResolver } from "./helpers/ai-model-resolver-fixtures";

test("resolveUserLanguageModel resolves OpenRouter models through OpenRouter keys", async () => {
  const { createResolveUserLanguageModel } = await loadAiModelResolver();
  const originalGatewayApiKey = process.env.AI_GATEWAY_API_KEY;
  process.env.AI_GATEWAY_API_KEY = "platform-gateway-key";

  try {
    const resolver = createResolveUserLanguageModel({
      getProviderKey: async (_userId, provider) => {
        if (provider === "ai_gateway") return "user-gateway-key";
        if (provider === "openrouter") return "user-openrouter-key";
        return null;
      },
      loadUserPlatformAccess: async () => ({
        allowPlatformAi: true,
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
      resolveOpenRouterModel: (apiKey, modelId) =>
        ({ apiKey, modelId }) as never,
    });

    const resolved = await resolver("user-123", "openrouter/openai/gpt-5.2");
    assert.deepEqual(resolved.model, {
      apiKey: "user-openrouter-key",
      modelId: "openai/gpt-5.2:nitro",
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

test("resolveUserLanguageModel requires an OpenRouter key for OpenRouter catalog ids", async () => {
  const { createResolveUserLanguageModel } = await loadAiModelResolver();
  const originalGatewayApiKey = process.env.AI_GATEWAY_API_KEY;
  process.env.AI_GATEWAY_API_KEY = "platform-gateway-key";

  try {
    const resolver = createResolveUserLanguageModel({
      getProviderKey: async (_userId, provider) =>
        provider === "ai_gateway" ? "user-gateway-key" : null,
      loadUserPlatformAccess: async () => ({
        allowPlatformAi: true,
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
    });

    await assert.rejects(
      () => resolver("user-123", "openrouter/openai/gpt-5.2"),
      /No OpenRouter API key configured/
    );
  } finally {
    if (originalGatewayApiKey === undefined) {
      delete process.env.AI_GATEWAY_API_KEY;
    } else {
      process.env.AI_GATEWAY_API_KEY = originalGatewayApiKey;
    }
  }
});

test("getOpenRouterAppUrl omits appUrl when NEXT_PUBLIC_APP_URL is unset", async () => {
  const { getOpenRouterAppUrl } = await loadAiModelResolver();
  const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;

  try {
    delete process.env.NEXT_PUBLIC_APP_URL;
    assert.equal(getOpenRouterAppUrl(), undefined);

    process.env.NEXT_PUBLIC_APP_URL = "";
    assert.equal(getOpenRouterAppUrl(), undefined);

    process.env.NEXT_PUBLIC_APP_URL = "   ";
    assert.equal(getOpenRouterAppUrl(), undefined);

    process.env.NEXT_PUBLIC_APP_URL = " https://preview.mogplex.example ";
    assert.equal(getOpenRouterAppUrl(), "https://preview.mogplex.example");
  } finally {
    if (originalAppUrl === undefined) {
      delete process.env.NEXT_PUBLIC_APP_URL;
    } else {
      process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
    }
  }
});

test("resolveUserLanguageModel applies :nitro to OpenRouter models without an explicit variant", async () => {
  const { createResolveUserLanguageModel } = await loadAiModelResolver();
  const originalGatewayApiKey = process.env.AI_GATEWAY_API_KEY;
  delete process.env.AI_GATEWAY_API_KEY;

  try {
    const resolver = createResolveUserLanguageModel({
      getProviderKey: async (_userId, provider) =>
        provider === "openrouter" ? "user-openrouter-key" : null,
      loadUserPlatformAccess: async () => ({ allowPlatformAi: false }),
      resolveGatewayModel: () => {
        throw new Error("resolveGatewayModel should not be called");
      },
      resolveOpenAIModel: () => {
        throw new Error("resolveOpenAIModel should not be called");
      },
      resolveAnthropicModel: () => {
        throw new Error("resolveAnthropicModel should not be called");
      },
      resolveOpenRouterModel: (apiKey, modelId) =>
        ({ apiKey, modelId }) as never,
    });

    const resolved = await resolver(
      "user-123",
      "openrouter/deepseek/deepseek-v4-pro"
    );
    assert.deepEqual(resolved.model, {
      apiKey: "user-openrouter-key",
      modelId: "deepseek/deepseek-v4-pro:nitro",
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

test("resolveUserLanguageModel respects an explicit OpenRouter variant", async () => {
  const { createResolveUserLanguageModel } = await loadAiModelResolver();
  const originalGatewayApiKey = process.env.AI_GATEWAY_API_KEY;
  delete process.env.AI_GATEWAY_API_KEY;

  try {
    const resolver = createResolveUserLanguageModel({
      getProviderKey: async (_userId, provider) =>
        provider === "openrouter" ? "user-openrouter-key" : null,
      loadUserPlatformAccess: async () => ({ allowPlatformAi: false }),
      resolveGatewayModel: () => {
        throw new Error("resolveGatewayModel should not be called");
      },
      resolveOpenAIModel: () => {
        throw new Error("resolveOpenAIModel should not be called");
      },
      resolveAnthropicModel: () => {
        throw new Error("resolveAnthropicModel should not be called");
      },
      resolveOpenRouterModel: (apiKey, modelId) =>
        ({ apiKey, modelId }) as never,
    });

    const resolved = await resolver(
      "user-123",
      "openrouter/deepseek/deepseek-v4-pro:floor"
    );
    assert.deepEqual(resolved.model, {
      apiKey: "user-openrouter-key",
      modelId: "deepseek/deepseek-v4-pro:floor",
    });
  } finally {
    if (originalGatewayApiKey === undefined) {
      delete process.env.AI_GATEWAY_API_KEY;
    } else {
      process.env.AI_GATEWAY_API_KEY = originalGatewayApiKey;
    }
  }
});
