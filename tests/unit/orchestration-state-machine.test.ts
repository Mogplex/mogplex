import assert from "node:assert/strict";
import test from "node:test";

async function loadStateMachine() {
  return import("../../lib/orchestrations/state-machine");
}

test("run state machine allows the happy path through completed", async () => {
  const { assertRunTransition, canTransitionRun } = await loadStateMachine();
  const happyPath = [
    "drafting_master_spec",
    "awaiting_master_approval",
    "generating_sub_specs",
    "awaiting_task_approval",
    "launching_sandboxes",
    "running_tasks",
    "integrating",
    "validating",
    "ready_for_pr",
    "pr_open",
    "completed",
  ] as const;

  for (let index = 0; index < happyPath.length - 1; index++) {
    const from = happyPath[index];
    const to = happyPath[index + 1];
    assert.equal(canTransitionRun(from, to), true, `${from} to ${to}`);
    assert.doesNotThrow(() => assertRunTransition(from, to));
  }
});

test("run state machine rejects skipped phases", async () => {
  const {
    OrchestrationTransitionError,
    assertRunTransition,
    canTransitionRun,
  } = await loadStateMachine();

  assert.equal(
    canTransitionRun("awaiting_master_approval", "running_tasks"),
    false
  );
  assert.throws(
    () => assertRunTransition("awaiting_master_approval", "running_tasks"),
    (error) =>
      error instanceof OrchestrationTransitionError &&
      error.entity === "run" &&
      error.from === "awaiting_master_approval" &&
      error.to === "running_tasks"
  );
});

test("run state machine covers conflict, failure, retry, cancel, and PR paths", async () => {
  const { canTransitionRun } = await loadStateMachine();

  assert.equal(canTransitionRun("integrating", "conflict_resolution"), true);
  assert.equal(canTransitionRun("integrating", "validating"), true);
  assert.equal(canTransitionRun("integrating", "failed"), true);
  assert.equal(canTransitionRun("integrating", "ready_for_pr"), false);

  assert.equal(canTransitionRun("conflict_resolution", "integrating"), true);
  assert.equal(canTransitionRun("validating", "integrating"), true);
  assert.equal(canTransitionRun("failed", "integrating"), true);
  assert.equal(canTransitionRun("failed", "conflict_resolution"), true);
  assert.equal(canTransitionRun("failed", "drafting_master_spec"), true);
  assert.equal(canTransitionRun("failed", "awaiting_task_approval"), true);
  assert.equal(canTransitionRun("failed", "awaiting_master_approval"), false);

  assert.equal(canTransitionRun("ready_for_pr", "pr_open"), true);
  assert.equal(canTransitionRun("ready_for_pr", "completed"), false);
  assert.equal(canTransitionRun("pr_open", "completed"), true);
  assert.equal(canTransitionRun("pr_open", "cancelled"), true);

  assert.equal(canTransitionRun("running_tasks", "cancelled"), true);
  assert.equal(canTransitionRun("cancelled", "running_tasks"), false);
  assert.equal(canTransitionRun("cancelled", "cancelled"), false);
  assert.equal(canTransitionRun("completed", "completed"), false);
  assert.equal(canTransitionRun("failed", "failed"), true);
  assert.equal(canTransitionRun("completed", "failed"), false);
});

test("task state machine allows the happy path through merged", async () => {
  const { assertTaskTransition, canTransitionTask } = await loadStateMachine();
  const happyPath = [
    "planned",
    "queued",
    "launching_sandbox",
    "running",
    "pushed",
    "merge_ready",
    "merged",
  ] as const;

  for (let index = 0; index < happyPath.length - 1; index++) {
    const from = happyPath[index];
    const to = happyPath[index + 1];
    assert.equal(canTransitionTask(from, to), true, `${from} to ${to}`);
    assert.doesNotThrow(() => assertTaskTransition(from, to));
  }
});

test("task state machine rejects skipped phases", async () => {
  const {
    OrchestrationTransitionError,
    assertTaskTransition,
    canTransitionTask,
  } = await loadStateMachine();

  assert.equal(canTransitionTask("planned", "running"), false);
  assert.throws(
    () => assertTaskTransition("planned", "running"),
    (error) =>
      error instanceof OrchestrationTransitionError &&
      error.entity === "task" &&
      error.from === "planned" &&
      error.to === "running"
  );
});

test("task state machine covers pushed, failure, retry, cancel, and conflict paths", async () => {
  const { canTransitionTask } = await loadStateMachine();

  assert.equal(canTransitionTask("pushed", "merge_ready"), true);
  assert.equal(canTransitionTask("pushed", "merged"), true);
  assert.equal(canTransitionTask("pushed", "conflict"), true);
  assert.equal(canTransitionTask("pushed", "failed"), true);
  assert.equal(canTransitionTask("pushed", "running"), false);

  assert.equal(canTransitionTask("failed", "queued"), true);
  assert.equal(canTransitionTask("failed", "running"), true);
  assert.equal(canTransitionTask("needs_user", "running"), true);
  assert.equal(canTransitionTask("conflict", "merge_ready"), true);
  assert.equal(canTransitionTask("conflict", "running"), true);

  assert.equal(canTransitionTask("running", "cancelled"), true);
  assert.equal(canTransitionTask("cancelled", "queued"), false);
  assert.equal(canTransitionTask("cancelled", "cancelled"), false);
  assert.equal(canTransitionTask("merged", "merged"), false);
  assert.equal(canTransitionTask("failed", "failed"), true);
  assert.equal(canTransitionTask("merged", "failed"), false);
});
