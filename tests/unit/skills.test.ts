import assert from "node:assert/strict";
import test from "node:test";
import {
  formatSkillScope,
  GLOBAL_SKILL_SCOPE,
  SKILL_SCOPE_LABELS,
} from "../../lib/skills";

test("formatSkillScope renders Agent Skills scope labels", () => {
  assert.equal(SKILL_SCOPE_LABELS.global, "Global");
  assert.equal(SKILL_SCOPE_LABELS.project, "Project-specific");

  for (const scope of Object.keys(SKILL_SCOPE_LABELS) as Array<
    keyof typeof SKILL_SCOPE_LABELS
  >) {
    assert.equal(formatSkillScope(scope), SKILL_SCOPE_LABELS[scope]);
  }
});

async function loadSkillsRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/skills/route");
}

test("createScopedSkillResponse rejects null Supabase rows", async () => {
  const { createScopedSkillResponse } = await loadSkillsRoute();

  const response = createScopedSkillResponse(null);

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "Skill not found" });
});

test("createScopedSkillResponse adds the global skill scope", async () => {
  const { createScopedSkillResponse } = await loadSkillsRoute();

  const response = createScopedSkillResponse({ id: "skill-1", name: "Review" });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    id: "skill-1",
    name: "Review",
    scope: GLOBAL_SKILL_SCOPE,
  });
});
