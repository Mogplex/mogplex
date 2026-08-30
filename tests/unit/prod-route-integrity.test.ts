import assert from "node:assert/strict";
import test from "node:test";

function prepareRouteEnv() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
}

test("service-role content routes allowlist caller-controlled writes", async () => {
  prepareRouteEnv();
  const [{ pickSkillWriteFields }, { pickRuleWriteFields }, commands] =
    await Promise.all([
      import("../../app/api/skills/route"),
      import("../../app/api/rules/route"),
      import("../../app/api/commands/route"),
    ]);

  const hostile = {
    id: "chosen-id",
    user_id: "victim-user",
    created_at: "2000-01-01T00:00:00.000Z",
    updated_at: "2000-01-01T00:00:00.000Z",
    usage_count: 999,
    name: "Review",
    description: "Review changes",
    content: "Be precise",
    template: "Review $ARGS",
    type: "prompt",
    model: "openai/gpt-5.6-sol",
    is_public: true,
    tags: ["review"],
  };

  assert.deepEqual(pickSkillWriteFields(hostile), {
    name: "Review",
    description: "Review changes",
    content: "Be precise",
    type: "prompt",
    model: "openai/gpt-5.6-sol",
    is_public: true,
    tags: ["review"],
  });
  assert.deepEqual(pickRuleWriteFields(hostile), {
    name: "Review",
    content: "Be precise",
    type: "prompt",
  });
  assert.deepEqual(commands.pickCommandCreateFields(hostile), {
    name: "Review",
    description: "Review changes",
    template: "Review $ARGS",
  });
});

test("derived state persistence rejects database write failures", async () => {
  prepareRouteEnv();
  const [{ persistMonorepoDetection }, { persistSandboxExtensionActivity }] =
    await Promise.all([
      import("../../app/api/repos/[id]/monorepo/route"),
      import("../../app/api/sandbox/[id]/extend/route"),
    ]);

  await assert.rejects(
    persistMonorepoDetection("repo-1", async () => ({
      error: { message: "write failed" },
    })),
    /Failed to save detected repository structure/
  );
  await assert.rejects(
    persistSandboxExtensionActivity("sandbox-1", async () => ({
      error: { message: "write failed" },
    })),
    /Failed to record sandbox activity/
  );
});
