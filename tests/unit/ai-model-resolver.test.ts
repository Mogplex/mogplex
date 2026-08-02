import assert from "node:assert/strict";
import test from "node:test";

async function loadAiModelResolver() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../lib/ai-model-resolver");
}

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
      /Platform AI access is not enabled for this account/
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
