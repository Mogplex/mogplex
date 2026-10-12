import assert from "node:assert/strict";
import test from "node:test";
import { loadAiModelResolver } from "./helpers/ai-model-resolver-fixtures";

const ENV_KEYS = [
  "AI_GATEWAY_API_KEY",
  "MOGPLEX_OPENAI_COMPATIBLE_BASE_URL",
  "MOGPLEX_OPENAI_COMPATIBLE_API_KEY",
] as const;

async function withEnv(
  values: Partial<Record<(typeof ENV_KEYS)[number], string>>,
  fn: () => Promise<void>
) {
  const original = Object.fromEntries(
    ENV_KEYS.map((key) => [key, process.env[key]])
  );
  try {
    for (const key of ENV_KEYS) {
      const value = values[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fn();
  } finally {
    for (const key of ENV_KEYS) {
      const value = original[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function createResolver() {
  const { createResolveUserLanguageModel } = await loadAiModelResolver();
  return createResolveUserLanguageModel({
    loadUsableFallbackModelIds: async () => null,
    // The user and the platform both have gateway access.
    getProviderKey: async (_userId, provider) =>
      provider === "ai_gateway" ? "user-gateway-key" : null,
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
    resolveOpenRouterModel: () => {
      throw new Error("resolveOpenRouterModel should not be called");
    },
  });
}

test("resolveUserLanguageModel sends openai-compatible models to the configured endpoint, not AI Gateway", async () => {
  await withEnv(
    {
      AI_GATEWAY_API_KEY: "platform-gateway-key",
      MOGPLEX_OPENAI_COMPATIBLE_BASE_URL: "https://litellm.example/v1",
      MOGPLEX_OPENAI_COMPATIBLE_API_KEY: "sk-local",
    },
    async () => {
      const resolver = await createResolver();
      const resolved = await resolver(
        "user-123",
        "openai-compatible/llama3.1:8b"
      );

      assert.equal(typeof resolved.model, "object");
      const model = resolved.model as { provider: string; modelId: string };
      assert.equal(model.provider, "openai-compatible.chat");
      assert.equal(model.modelId, "llama3.1:8b");
      assert.equal(resolved.providerOptions, undefined);
      assert.equal(resolved.fallbackModels, undefined);
    }
  );
});

test("resolveUserLanguageModel reports a missing endpoint for openai-compatible models", async () => {
  await withEnv({ AI_GATEWAY_API_KEY: "platform-gateway-key" }, async () => {
    const resolver = await createResolver();
    await assert.rejects(
      resolver("user-123", "openai-compatible/llama3.1:8b"),
      /MOGPLEX_OPENAI_COMPATIBLE_BASE_URL/
    );
  });
});
