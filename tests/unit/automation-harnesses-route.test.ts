import assert from "node:assert/strict";
import test from "node:test";

async function loadRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/automations/harnesses/route");
}

test("automation harness availability follows configured provider keys", async () => {
  const { createAutomationHarnessesGetHandler } = await loadRoute();
  const handler = createAutomationHarnessesGetHandler({
    requireUserId: async () => "user-123",
    resolveSandboxAiAccess: async () => ({
      aiBillingSource: "direct_provider",
      gatewayApiKey: null,
      platformAccessRestricted: false,
      providerKeys: {
        anthropic: "anthropic-key",
        openai: null,
      },
    }),
  });

  const response = await handler();

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    harnesses: {
      mogplex: {
        available: true,
        billingSource: "mogplex",
        reason: null,
      },
      "claude-code": {
        available: true,
        billingSource: "direct_provider",
        reason: null,
      },
      codex: {
        available: false,
        billingSource: null,
        reason:
          "No OpenAI API key configured. Add one in Settings > API Keys or configure an AI Gateway key.",
      },
    },
  });
});

test("AI Gateway access enables both CLI harnesses", async () => {
  const { createAutomationHarnessesGetHandler } = await loadRoute();
  const handler = createAutomationHarnessesGetHandler({
    requireUserId: async () => "user-123",
    resolveSandboxAiAccess: async () => ({
      aiBillingSource: "user_ai_gateway",
      gatewayApiKey: "gateway-key",
      platformAccessRestricted: false,
      providerKeys: {
        anthropic: null,
        openai: null,
      },
    }),
  });

  const response = await handler();
  const payload = await response.json();

  assert.equal(payload.harnesses["claude-code"].available, true);
  assert.equal(payload.harnesses.codex.available, true);
});
