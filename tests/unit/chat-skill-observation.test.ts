import assert from "node:assert/strict";
import test from "node:test";
import type { SkillSelectionInput } from "../../lib/decisions/skills";
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

const scope = {
  surface: "chat",
  userId: "user-1",
  teamId: "team-1",
  repoId: "repo-1",
  aiCallId: "call-1",
  conversationId: "conv-1",
};

async function load() {
  return import("../../app/api/chat/_lib/skill-observation");
}

test("workspace chat records the skills a turn needed and keeps the check alive past the response", async () => {
  const { observeChatSkills } = await load();
  const checks: SkillSelectionInput[] = [];
  const deferred: Array<() => Promise<void>> = [];
  const neverSettles = new Promise<void>(() => {});

  const returned: unknown = observeChatSkills(
    {
      skills: { invoked: [deploy], available: [deploy] },
      request: "/deploy-checklist staging",
      scope,
    },
    {
      observe: (input) => {
        checks.push(input);
        return neverSettles;
      },
      runAfterResponse: (work) => deferred.push(work),
    }
  );

  assert.equal(returned, undefined, "nothing for the turn to await");
  assert.deepEqual(checks, [
    {
      catalog: { skills: [deploy], invokedIds: ["s1"] },
      request: "/deploy-checklist staging",
      delivery: "inline",
      scope,
    },
  ]);
  assert.equal(deferred.length, 1);
  assert.equal(deferred[0]?.(), neverSettles);
});

test("workspace chat asks nothing for a user without skills and survives a missing request scope", async () => {
  const { observeChatSkills } = await load();
  let asked = 0;
  observeChatSkills(
    { skills: { invoked: [], available: [] }, request: "hi", scope },
    {
      observe: async () => {
        asked += 1;
      },
      runAfterResponse: () => {},
    }
  );
  assert.equal(asked, 0);

  assert.doesNotThrow(() =>
    observeChatSkills(
      { skills: { invoked: [], available: [deploy] }, request: "hi", scope },
      {
        observe: async () => {
          asked += 1;
        },
        runAfterResponse: () => {
          throw new Error("after() called outside a request scope");
        },
      }
    )
  );
  assert.equal(asked, 1);
});
