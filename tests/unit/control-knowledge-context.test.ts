import assert from "node:assert/strict";
import test from "node:test";
import type { ControlKnowledgeDeps } from "../../app/api/control/chat/_lib/knowledge-context";
import type { CatalogSkill } from "../../lib/skill-catalog/types";

process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";

const deploy: CatalogSkill = {
  id: "s1",
  slug: "deploy-checklist",
  name: "Deploy checklist",
  description: null,
  content: "1. Run the tests.",
  tags: [],
  source: "library",
};

function userMessage(text: string) {
  return { role: "user", parts: [{ type: "text", text }] };
}

type KnowledgeModule =
  typeof import("../../app/api/control/chat/_lib/knowledge-context");

function importKnowledge(): Promise<KnowledgeModule> {
  return import("../../app/api/control/chat/_lib/knowledge-context");
}

function load(
  { loadControlKnowledgeContext }: KnowledgeModule,
  deps: ControlKnowledgeDeps,
  onMemoriesSelected?: () => void
) {
  return loadControlKnowledgeContext(
    {
      userId: "user-1",
      repoId: "repo-1",
      latestUserText: "now production",
      messages: [
        userMessage("/deploy-checklist staging"),
        { role: "assistant", parts: [{ type: "text", text: "$ignored" }] },
        userMessage("now production"),
      ],
      onMemoriesSelected,
    },
    deps
  );
}

test("Control loads memories and skills for a turn from the whole conversation", async () => {
  const memoryCalls: unknown[] = [];
  const skillCalls: unknown[] = [];
  const onSelected = () => {};
  const knowledge = await load(
    await importKnowledge(),
    {
      loadMemoryContext: async (input) => {
        memoryCalls.push(input);
        return "## Facts\n- Uses pnpm";
      },
      resolveSkills: async (input) => {
        skillCalls.push(input);
        return { invoked: [deploy], available: [deploy] };
      },
    },
    onSelected
  );

  assert.deepEqual(knowledge, {
    memoryContext: "## Facts\n- Uses pnpm",
    skills: { invoked: [deploy], available: [deploy] },
  });
  assert.deepEqual(memoryCalls, [
    {
      userId: "user-1",
      repoId: "repo-1",
      query: "now production",
      onSelected,
    },
  ]);
  // Every user message is scanned, so a skill invoked on turn one still holds.
  assert.deepEqual(skillCalls, [
    {
      userId: "user-1",
      repoId: "repo-1",
      userTexts: ["/deploy-checklist staging", "now production"],
    },
  ]);
});

test("Control starts both loads together rather than one after the other", async () => {
  const knowledgeModule = await importKnowledge();
  const order: string[] = [];
  let releaseMemory: (value: string | null) => void = () => {};
  const pending = load(knowledgeModule, {
    loadMemoryContext: () =>
      new Promise((resolve) => {
        order.push("memory:start");
        releaseMemory = resolve;
      }),
    resolveSkills: async () => {
      order.push("skills:start");
      return { invoked: [], available: [] };
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ["memory:start", "skills:start"]);
  releaseMemory(null);
  assert.equal((await pending).memoryContext, null);
});

test("the Control prompt context carries the loaded skills to the system prompt", async () => {
  const { buildControlPromptContext } =
    await import("../../app/api/control/chat/_lib/prompt-context");
  const context = buildControlPromptContext({
    body: { messages: [] } as never,
    missionId: null,
    infrastructureDiagnosticScope: {} as never,
    sandboxContext: { selectionRequired: false, sandboxes: [] } as never,
    worktreeContext: { worktrees: [] } as never,
    knowledge: {
      memoryContext: "## Facts",
      skills: { invoked: [deploy], available: [deploy] },
    },
  });
  assert.equal(context.memoryContext, "## Facts");
  assert.deepEqual(context.skills, { invoked: [deploy], available: [deploy] });
});
