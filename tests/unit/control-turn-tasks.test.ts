import assert from "node:assert/strict";
import test from "node:test";
import { createControlTurnTasks } from "../../app/api/control/chat/_lib/turn-end";
import type { ControlMemoryContext } from "../../lib/agents/control-memory-context";
import type { MemoryRelevanceInput } from "../../lib/decisions/memory-relevance";

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
