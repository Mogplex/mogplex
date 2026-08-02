import assert from "node:assert/strict";
import test from "node:test";

function setTemplateForkEnv() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
}

test("resolveAgentTemplateFork throws on unexpected non-null RPC data", async () => {
  setTemplateForkEnv();
  const {
    AgentTemplateForkError,
    findPreconfiguredAgentTemplate,
    resolveAgentTemplateFork,
  } = await import("../../lib/agents/template-forks");
  const template = findPreconfiguredAgentTemplate("NEXTJS-REVIEWER");

  assert.ok(template);

  await assert.rejects(
    () =>
      resolveAgentTemplateFork("user-123", template, {
        resolveTemplateForkRpc: async () => ({
          data: { id: "agent-123" },
          error: null,
        }),
      }),
    (error) =>
      error instanceof AgentTemplateForkError &&
      error.message.includes("unexpected result")
  );
});

test("resolveAgentTemplateFork stamps new forks with the model override when provided", async () => {
  setTemplateForkEnv();
  const { findPreconfiguredAgentTemplate, resolveAgentTemplateFork } =
    await import("../../lib/agents/template-forks");
  const template = findPreconfiguredAgentTemplate("NEXTJS-REVIEWER");

  assert.ok(template);

  let forkedModel: string | null = null;
  const result = await resolveAgentTemplateFork("user-123", template, {
    modelOverride: "sakana/fugu-ultra",
    resolveTemplateForkRpc: async (args) => {
      forkedModel = args.p_model;
      return { data: "agent-123", error: null };
    },
  });

  assert.equal(result?.id, "agent-123");
  assert.equal(forkedModel, "sakana/fugu-ultra");
});

test("resolveAgentTemplateFork falls back to the template model without an override", async () => {
  setTemplateForkEnv();
  const { findPreconfiguredAgentTemplate, resolveAgentTemplateFork } =
    await import("../../lib/agents/template-forks");
  const template = findPreconfiguredAgentTemplate("NEXTJS-REVIEWER");

  assert.ok(template);

  let forkedModel: string | null = null;
  await resolveAgentTemplateFork("user-123", template, {
    modelOverride: null,
    resolveTemplateForkRpc: async (args) => {
      forkedModel = args.p_model;
      return { data: "agent-123", error: null };
    },
  });

  assert.equal(forkedModel, template.model);
});
