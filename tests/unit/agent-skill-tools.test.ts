import assert from "node:assert/strict";
import test from "node:test";
import type { SkillCatalog } from "../../lib/skill-catalog/types";

process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";

type SkillSummary = { slug: string; source: string };
type ToolResult = {
  ok: boolean;
  error: string;
  total: number;
  count: number;
  skills: SkillSummary[];
  skill: SkillSummary & { content: string; truncated: boolean };
  suggestions: string[];
};

type Executable = {
  execute: (input: unknown, options: unknown) => Promise<ToolResult>;
  inputSchema: { safeParse: (value: unknown) => { success: boolean } };
};

const CATALOG: SkillCatalog = {
  skills: [
    {
      id: "s1",
      slug: "deploy-checklist",
      name: "Deploy checklist",
      description: "Steps before shipping",
      content: "1. Run the tests.",
      tags: ["release"],
      source: "library",
    },
    {
      id: "s2",
      slug: "release-notes",
      name: "Release notes",
      description: null,
      content: "Group changes by area.",
      tags: [],
      source: "repo",
    },
  ],
};

const TOOL_OPTIONS = { toolCallId: "call-1", messages: [] };

async function buildTools(loadCatalog: () => Promise<SkillCatalog>) {
  const { createSkillTools } = await import("../../lib/agents/tools/skills");
  const calls: unknown[] = [];
  const tools = createSkillTools(
    { userId: "user-1", repoId: "repo-1" },
    {
      loadCatalog: (context) => {
        calls.push(context);
        return loadCatalog();
      },
    }
  ) as unknown as Record<"find_skills" | "load_skill", Executable>;
  return { tools, calls };
}

test("find_skills ranks matches and reads the catalog once per run", async () => {
  const { tools, calls } = await buildTools(async () => CATALOG);

  const found = await tools.find_skills.execute(
    { query: "shipping a release", limit: 10 },
    TOOL_OPTIONS
  );
  assert.equal(found.ok, true);
  assert.equal(found.total, 2);
  assert.deepEqual(
    found.skills.map((skill) => skill.slug),
    ["deploy-checklist", "release-notes"]
  );
  assert.equal("content" in found.skills[0], false);

  const all = await tools.find_skills.execute({ limit: 10 }, TOOL_OPTIONS);
  assert.equal(all.count, 2);

  await tools.load_skill.execute({ slug: "release-notes" }, TOOL_OPTIONS);
  assert.deepEqual(calls, [{ userId: "user-1", repoId: "repo-1" }]);
});

test("load_skill returns the full instructions for a slug typed any way", async () => {
  const { tools } = await buildTools(async () => CATALOG);
  for (const slug of [
    "deploy-checklist",
    "$Deploy_Checklist",
    " /deploy-checklist ",
  ]) {
    const loaded = await tools.load_skill.execute({ slug }, TOOL_OPTIONS);
    assert.equal(loaded.ok, true, slug);
    assert.equal(loaded.skill.content, "1. Run the tests.");
    assert.equal(loaded.skill.truncated, false);
    assert.equal(loaded.skill.source, "library");
  }
});

test("load_skill names close matches when the slug is unknown", async () => {
  const { tools } = await buildTools(async () => CATALOG);
  const missing = await tools.load_skill.execute(
    { slug: "release-checklist" },
    TOOL_OPTIONS
  );
  assert.equal(missing.ok, false);
  assert.match(missing.error, /release-checklist/);
  assert.deepEqual(missing.suggestions, ["deploy-checklist", "release-notes"]);
});

test("load_skill caps a very long skill and says so", async () => {
  const { LOAD_SKILL_MAX_CHARS } =
    await import("../../lib/agents/tools/skills");
  const { tools } = await buildTools(async () => ({
    skills: [
      { ...CATALOG.skills[0], content: "x".repeat(LOAD_SKILL_MAX_CHARS + 1) },
    ],
  }));
  const loaded = await tools.load_skill.execute(
    { slug: "deploy-checklist" },
    TOOL_OPTIONS
  );
  assert.equal(loaded.skill.content.length, LOAD_SKILL_MAX_CHARS);
  assert.equal(loaded.skill.truncated, true);
});

test("a failed catalog read is reported, then retried on the next call", async () => {
  let attempts = 0;
  const { tools } = await buildTools(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("database offline");
    return CATALOG;
  });
  const failed = await tools.find_skills.execute({ limit: 10 }, TOOL_OPTIONS);
  assert.deepEqual(failed, { ok: false, error: "database offline" });
  const retried = await tools.find_skills.execute({ limit: 10 }, TOOL_OPTIONS);
  assert.equal(retried.ok, true);
  assert.equal(attempts, 2);
});

test("skill tool inputs are validated", async () => {
  const { tools } = await buildTools(async () => CATALOG);
  assert.equal(tools.load_skill.inputSchema.safeParse({}).success, false);
  assert.equal(
    tools.load_skill.inputSchema.safeParse({ slug: "" }).success,
    false
  );
  assert.equal(
    tools.find_skills.inputSchema.safeParse({ limit: 0 }).success,
    false
  );
  assert.equal(tools.find_skills.inputSchema.safeParse({}).success, true);
});

test("buildStaticTools offers skill tools to a signed-in user only", async () => {
  const { buildStaticTools } = await import("../../lib/agents/tools");
  const signedIn = buildStaticTools(undefined, "user-1");
  assert.ok("find_skills" in signedIn);
  assert.ok("load_skill" in signedIn);
  const anonymous = buildStaticTools();
  assert.equal("find_skills" in anonymous, false);
  assert.equal("load_skill" in anonymous, false);
});

test("every team role keeps the skill tools, including viewers", async () => {
  const { buildStaticTools } = await import("../../lib/agents/tools");
  const { presetForRole } = await import("../../lib/team-capabilities");
  for (const role of ["viewer", "developer"] as const) {
    const tools = buildStaticTools(
      undefined,
      "user-1",
      null,
      undefined,
      undefined,
      undefined,
      presetForRole(role)
    );
    assert.ok("find_skills" in tools, role);
    assert.ok("load_skill" in tools, role);
  }
  const none = buildStaticTools(
    undefined,
    "user-1",
    null,
    undefined,
    undefined,
    undefined,
    new Set(["tools.web_search"])
  );
  assert.equal("load_skill" in none, false);
});
