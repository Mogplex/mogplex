import assert from "node:assert/strict";
import test from "node:test";
import { createControlTurnTasks } from "../../app/api/control/chat/_lib/turn-end";
import type { ControlMemoryContext } from "../../lib/agents/control-memory-context";
import type { MemoryRelevanceInput } from "../../lib/decisions/memory-relevance";
import type { SkillSelectionInput } from "../../lib/decisions/skills";
import type { CatalogSkill } from "../../lib/skill-catalog/types";

const selected: ControlMemoryContext = {
  semantic: [
    {
      id: "m-1",
      lane: "semantic",
      content: "Uses pnpm.",
      created_at: "2026-09-10T00:00:00.000Z",
      updated_at: "2026-09-10T00:00:00.000Z",
    },
  ],
  procedural: [],
  episodic: [],
  relevant: [],
};

function buildTasks(observe: (input: MemoryRelevanceInput) => Promise<void>) {
  return createControlTurnTasks({
    userId: "user-1",
    teamId: "team-1",
    // No conversation: promotion has nothing to read and returns at once.
    conversationId: null,
    repoId: "repo-1",
    aiCallId: "call-1",
    userText: "Rename the billing page",
    observeMemories: observe,
  });
}

test("the memory relevance check starts beside the turn and carries the turn's scope", () => {
  const checks: MemoryRelevanceInput[] = [];
  const tasks = buildTasks((input) => {
    checks.push(input);
    // Never settles: the prompt load must not depend on it.
    return new Promise(() => {});
  });

  const returned: unknown = tasks.onMemoriesSelected(selected);

  assert.equal(returned, undefined, "nothing for the prompt load to await");
  assert.equal(checks.length, 1);
  assert.equal(checks[0]?.request, "Rename the billing page");
  assert.equal(checks[0]?.groups, selected);
  assert.deepEqual(checks[0]?.scope, {
    surface: "control",
    userId: "user-1",
    teamId: "team-1",
    repoId: "repo-1",
    aiCallId: "call-1",
    conversationId: null,
  });
});

test("the end of the turn waits for the memory relevance check so it is not dropped", async () => {
  let settled = false;
  const tasks = buildTasks(async () => {
    await new Promise((resolve) => setTimeout(resolve, 40));
    settled = true;
  });
  tasks.onMemoriesSelected(selected);

  await tasks.onEnd({ model: {} as never, steps: [] });

  assert.equal(settled, true);
});

test("a turn that injected no memories ends without a check", async () => {
  let asked = false;
  const tasks = buildTasks(async () => {
    asked = true;
  });

  await tasks.onEnd({ model: {} as never, steps: [] });

  assert.equal(asked, false);
});

const deploySkill: CatalogSkill = {
  id: "s1",
  slug: "deploy-checklist",
  name: "Deploy checklist",
  description: null,
  content: "1. Run the tests.",
  tags: [],
  source: "library",
};
const notesSkill: CatalogSkill = {
  ...deploySkill,
  id: "s2",
  slug: "release-notes",
  name: "Release notes",
};

function buildSkillTasks(
  observe: (input: SkillSelectionInput) => Promise<void>
) {
  return createControlTurnTasks({
    userId: "user-1",
    teamId: "team-1",
    conversationId: null,
    repoId: "repo-1",
    aiCallId: "call-1",
    userText: "Ship it with $deploy-checklist",
    observeSkills: observe,
  });
}

test("the skill check starts beside the turn with the catalog and what the operator invoked", () => {
  const checks: SkillSelectionInput[] = [];
  const tasks = buildSkillTasks((input) => {
    checks.push(input);
    return new Promise(() => {});
  });

  const returned: unknown = tasks.onSkillsResolved({
    invoked: [deploySkill],
    available: [deploySkill, notesSkill],
  });

  assert.equal(returned, undefined, "nothing for the prompt load to await");
  assert.equal(checks.length, 1);
  assert.equal(checks[0]?.request, "Ship it with $deploy-checklist");
  assert.equal(checks[0]?.delivery, "inline");
  assert.deepEqual(checks[0]?.catalog, {
    skills: [deploySkill, notesSkill],
    invokedIds: ["s1"],
  });
  assert.equal(checks[0]?.scope.surface, "control");
  assert.equal(checks[0]?.scope.teamId, "team-1");
});

test("the end of the turn waits for the skill check so it is not dropped", async () => {
  let settled = false;
  const tasks = buildSkillTasks(async () => {
    await new Promise((resolve) => setTimeout(resolve, 40));
    settled = true;
  });
  tasks.onSkillsResolved({ invoked: [], available: [notesSkill] });

  await tasks.onEnd({ model: {} as never, steps: [] });

  assert.equal(settled, true);
});
