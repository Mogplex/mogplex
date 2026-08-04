import assert from "node:assert/strict";
import test from "node:test";

async function loadSandboxAiRuntime() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../lib/sandbox/ai-runtime");
}

test("resolveSandboxAiAccess prefers a user AI Gateway key over platform and direct provider keys", async () => {
  const { createResolveSandboxAiAccess } = await loadSandboxAiRuntime();

  const resolveSandboxAiAccess = createResolveSandboxAiAccess({
    getProviderKey: async (_userId, provider) => {
      if (provider === "ai_gateway") return "user-gateway-key";
      if (provider === "anthropic") return "anthropic-key";
      if (provider === "openai") return "openai-key";
      return null;
    },
    getPlatformGatewayApiKey: () => "platform-gateway-key",
    loadUserPlatformAccess: async () => ({
      allowPlatformAi: true,
    }),
  });

  const access = await resolveSandboxAiAccess("user-123");
  assert.deepEqual(access, {
    aiBillingSource: "user_ai_gateway",
    gatewayApiKey: "user-gateway-key",
    platformAccessRestricted: false,
    providerKeys: {
      anthropic: null,
      openai: null,
    },
  });
});

test("buildSandboxHarnessAiEnv uses Anthropic-compatible gateway env for Claude Code", async () => {
  const { buildSandboxHarnessAiEnv } = await loadSandboxAiRuntime();

  const env = buildSandboxHarnessAiEnv(
    {
      aiBillingSource: "user_ai_gateway",
      gatewayApiKey: "gateway-key",
      platformAccessRestricted: false,
      providerKeys: {
        anthropic: null,
        openai: null,
      },
    },
    "claude-code"
  );

  assert.equal(env.ok, true);
  if (!env.ok) return;
  assert.equal(env.aiBillingSource, "user_ai_gateway");
  assert.deepEqual(env.env, {
    ANTHROPIC_BASE_URL: "https://ai-gateway.vercel.sh",
    ANTHROPIC_AUTH_TOKEN: "gateway-key",
    ANTHROPIC_API_KEY: "",
  });
});

test("buildSandboxTerminalAiEnv falls back to direct provider keys when no gateway key exists", async () => {
  const { buildSandboxTerminalAiEnv } = await loadSandboxAiRuntime();

  const env = buildSandboxTerminalAiEnv({
    aiBillingSource: null,
    gatewayApiKey: null,
    platformAccessRestricted: false,
    providerKeys: {
      anthropic: "anthropic-key",
      openai: "openai-key",
    },
  });

  assert.equal(env.aiBillingSource, "direct_provider");
  assert.deepEqual(env.env, {
    OPENAI_BASE_URL: "",
    OPENAI_API_KEY: "openai-key",
    CODEX_API_KEY: "openai-key",
    ANTHROPIC_BASE_URL: "",
    ANTHROPIC_AUTH_TOKEN: "",
    ANTHROPIC_API_KEY: "anthropic-key",
  });
});

test("buildSandboxTerminalAiEnv in gateway mode only injects OpenAI-compatible env by default", async () => {
  const { buildSandboxTerminalAiEnv } = await loadSandboxAiRuntime();

  const env = buildSandboxTerminalAiEnv({
    aiBillingSource: "platform_ai_gateway",
    gatewayApiKey: "platform-gateway-key",
    platformAccessRestricted: false,
    providerKeys: {
      anthropic: null,
      openai: null,
    },
  });

  assert.equal(env.aiBillingSource, "platform_ai_gateway");
  assert.deepEqual(env.env, {
    OPENAI_BASE_URL: "https://ai-gateway.vercel.sh/v1",
    OPENAI_API_KEY: "platform-gateway-key",
    CODEX_API_KEY: "platform-gateway-key",
  });
});

test("buildSandboxTerminalShellAiEnv in gateway mode keeps Claude-compatible vars for the PTY shell", async () => {
  const { buildSandboxTerminalShellAiEnv } = await loadSandboxAiRuntime();

  const env = buildSandboxTerminalShellAiEnv({
    aiBillingSource: "platform_ai_gateway",
    gatewayApiKey: "platform-gateway-key",
    platformAccessRestricted: false,
    providerKeys: {
      anthropic: null,
      openai: null,
    },
  });

  assert.equal(env.aiBillingSource, "platform_ai_gateway");
  assert.deepEqual(env.env, {
    OPENAI_BASE_URL: "https://ai-gateway.vercel.sh/v1",
    OPENAI_API_KEY: "platform-gateway-key",
    CODEX_API_KEY: "platform-gateway-key",
    ANTHROPIC_BASE_URL: "https://ai-gateway.vercel.sh",
    ANTHROPIC_AUTH_TOKEN: "platform-gateway-key",
    ANTHROPIC_API_KEY: "",
  });
});

test("buildSandboxAiNetworkPolicy does not inject provider BYOK headers when gateway mode is active", async () => {
  const { buildSandboxAiNetworkPolicy } = await loadSandboxAiRuntime();

  const policy = buildSandboxAiNetworkPolicy({
    aiBillingSource: "platform_ai_gateway",
    gatewayApiKey: "platform-gateway-key",
    platformAccessRestricted: false,
    providerKeys: {
      anthropic: null,
      openai: null,
    },
  });

  assert.deepEqual(policy, {
    allow: {
      "ai-gateway.vercel.sh": [],
      "*": [],
    },
  });
});

test("buildSandboxAiNetworkPolicy includes provider BYOK headers in direct-provider mode", async () => {
  const { buildSandboxAiNetworkPolicy } = await loadSandboxAiRuntime();

  const policy = buildSandboxAiNetworkPolicy({
    aiBillingSource: "direct_provider",
    gatewayApiKey: null,
    platformAccessRestricted: false,
    providerKeys: {
      anthropic: "anthropic-key",
      openai: "openai-key",
    },
  });

  assert.deepEqual(policy, {
    allow: {
      "ai-gateway.vercel.sh": [
        {
          transform: [
            {
              headers: {
                "x-anthropic-api-key": "anthropic-key",
                "x-openai-api-key": "openai-key",
              },
            },
          ],
        },
      ],
      "*": [],
    },
  });
});

test("resolveSandboxAiAccess withholds platform gateway fallback for non-allowlisted users", async () => {
  const { createResolveSandboxAiAccess, buildSandboxHarnessAiEnv } =
    await loadSandboxAiRuntime();

  const resolveSandboxAiAccess = createResolveSandboxAiAccess({
    getProviderKey: async () => null,
    getPlatformGatewayApiKey: () => "platform-gateway-key",
    loadUserPlatformAccess: async () => ({
      allowPlatformAi: false,
    }),
  });

  const access = await resolveSandboxAiAccess("user-123");
  assert.deepEqual(access, {
    aiBillingSource: null,
    gatewayApiKey: null,
    platformAccessRestricted: true,
    providerKeys: {
      anthropic: null,
      openai: null,
    },
  });

  assert.deepEqual(buildSandboxHarnessAiEnv(access, "codex"), {
    ok: false,
    error:
      "Hosted AI requires a positive billing balance. Add funds or choose a plan in Settings > Billing, or add your own OpenAI or AI Gateway key in Settings > API Keys.",
  });
});

test("resolveSandboxAiAccess checks platform billing in the active team scope", async () => {
  const { createResolveSandboxAiAccess } = await loadSandboxAiRuntime();
  let resolvedTeamId: string | null | undefined;
  const resolveSandboxAiAccess = createResolveSandboxAiAccess({
    getProviderKey: async () => null,
    getPlatformGatewayApiKey: () => "platform-gateway-key",
    loadUserPlatformAccess: async (_userId, productTeamId) => {
      resolvedTeamId = productTeamId;
      return { allowPlatformAi: productTeamId === "team-paid" };
    },
  });

  const access = await resolveSandboxAiAccess("user-member", "team-paid");

  assert.equal(resolvedTeamId, "team-paid");
  assert.equal(access.aiBillingSource, "platform_ai_gateway");
  assert.equal(access.gatewayApiKey, "platform-gateway-key");
});
