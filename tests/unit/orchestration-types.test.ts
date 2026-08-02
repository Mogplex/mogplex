import assert from "node:assert/strict";
import test from "node:test";

async function loadStatus() {
  return import("../../lib/orchestrations/status");
}

function assertUnique(values: readonly string[]) {
  assert.equal(new Set(values).size, values.length);
}

test("orchestration status constants match the master spec values", async () => {
  const {
    ORCHESTRATION_EVENT_LEVELS,
    ORCHESTRATION_MERGE_EVENT_STATUSES,
    ORCHESTRATION_RUN_STATUSES,
    ORCHESTRATION_SPEC_KINDS,
    KNOWN_ORCHESTRATION_SPEC_STATUSES,
    ORCHESTRATION_TASK_STATUSES,
  } = await loadStatus();

  assert.deepEqual(ORCHESTRATION_RUN_STATUSES, [
    "drafting_master_spec",
    "awaiting_master_approval",
    "generating_sub_specs",
    "awaiting_task_approval",
    "launching_sandboxes",
    "running_tasks",
    "integrating",
    "conflict_resolution",
    "validating",
    "ready_for_pr",
    "pr_open",
    "completed",
    "failed",
    "cancelled",
  ]);
  assert.deepEqual(ORCHESTRATION_TASK_STATUSES, [
    "planned",
    "queued",
    "launching_sandbox",
    "running",
    "needs_user",
    "pushed",
    "merge_ready",
    "merged",
    "conflict",
    "failed",
    "cancelled",
  ]);
  assert.deepEqual(ORCHESTRATION_SPEC_KINDS, ["master", "task", "integration"]);
  assert.deepEqual(KNOWN_ORCHESTRATION_SPEC_STATUSES, ["draft", "approved"]);
  assert.deepEqual(ORCHESTRATION_MERGE_EVENT_STATUSES, [
    "started",
    "merged",
    "conflict",
    "resolved",
    "failed",
  ]);
  assert.deepEqual(ORCHESTRATION_EVENT_LEVELS, [
    "debug",
    "info",
    "warn",
    "error",
  ]);

  for (const values of [
    ORCHESTRATION_RUN_STATUSES,
    ORCHESTRATION_TASK_STATUSES,
    ORCHESTRATION_SPEC_KINDS,
    KNOWN_ORCHESTRATION_SPEC_STATUSES,
    ORCHESTRATION_MERGE_EVENT_STATUSES,
    ORCHESTRATION_EVENT_LEVELS,
  ]) {
    assertUnique(values);
  }
});

test("orchestration status predicates classify terminal and retryable states", async () => {
  const {
    isMergeBlockingTaskStatus,
    isOrchestrationApprovalMode,
    isOrchestrationEventLevel,
    isOrchestrationHarness,
    isOrchestrationMergeEventStatus,
    isOrchestrationRunStatus,
    isOrchestrationTaskStatus,
    isKnownOrchestrationSpecStatus,
    isRetryableRunStatus,
    isRetryableTaskStatus,
    isRunnableTaskStatus,
    isTerminalRunStatus,
    isTerminalTaskStatus,
  } = await loadStatus();

  assert.equal(isOrchestrationRunStatus("drafting_master_spec"), true);
  assert.equal(isOrchestrationRunStatus("drafting"), false);
  assert.equal(isOrchestrationTaskStatus("merge_ready"), true);
  assert.equal(isOrchestrationTaskStatus("ready"), false);
  assert.equal(isKnownOrchestrationSpecStatus("draft"), true);
  assert.equal(isKnownOrchestrationSpecStatus("archived"), false);
  assert.equal(isOrchestrationMergeEventStatus("resolved"), true);
  assert.equal(isOrchestrationMergeEventStatus("cancelled"), false);
  assert.equal(isOrchestrationEventLevel("warn"), true);
  assert.equal(isOrchestrationEventLevel("warning"), false);
  assert.equal(isOrchestrationApprovalMode("trusted_autopilot"), true);
  assert.equal(isOrchestrationApprovalMode("trusted"), false);
  assert.equal(isOrchestrationHarness("claude-code"), true);
  assert.equal(isOrchestrationHarness("claude"), false);

  assert.equal(isTerminalRunStatus("completed"), true);
  assert.equal(isTerminalRunStatus("failed"), false);
  assert.equal(isTerminalRunStatus("cancelled"), true);
  assert.equal(isTerminalRunStatus("ready_for_pr"), false);
  assert.equal(isRetryableRunStatus("failed"), true);
  assert.equal(isRetryableRunStatus("conflict_resolution"), false);
  assert.equal(isRetryableRunStatus("cancelled"), false);

  assert.equal(isTerminalTaskStatus("merged"), true);
  assert.equal(isTerminalTaskStatus("failed"), false);
  assert.equal(isTerminalTaskStatus("cancelled"), true);
  assert.equal(isRunnableTaskStatus("queued"), true);
  assert.equal(isRunnableTaskStatus("needs_user"), true);
  assert.equal(isRunnableTaskStatus("failed"), false);
  assert.equal(isRunnableTaskStatus("planned"), false);
  assert.equal(isRetryableTaskStatus("failed"), true);
  assert.equal(isRetryableTaskStatus("conflict"), true);
  assert.equal(isRetryableTaskStatus("merged"), false);
  assert.equal(isMergeBlockingTaskStatus("running"), true);
  assert.equal(isMergeBlockingTaskStatus("pushed"), false);
  assert.equal(isMergeBlockingTaskStatus("merge_ready"), false);
  assert.equal(isMergeBlockingTaskStatus("merged"), false);
  assert.equal(isMergeBlockingTaskStatus("cancelled"), false);
});

test("orchestration branch builders use the specified branch layout", async () => {
  const { buildIntegrationBranch, buildSpecBranch, buildTaskBranch } =
    await import("../../lib/orchestrations/branches");

  assert.equal(
    buildSpecBranch("git-tree-orchestration"),
    "mogplex/spec/git-tree-orchestration"
  );
  assert.equal(
    buildTaskBranch("git-tree-orchestration", "state-machine"),
    "mogplex/task/git-tree-orchestration/state-machine"
  );
  assert.equal(
    buildIntegrationBranch("git-tree-orchestration"),
    "mogplex/integrate/git-tree-orchestration"
  );
  assert.throws(() => buildSpecBranch("Invalid Run"));
  assert.throws(() =>
    buildTaskBranch("git-tree-orchestration", "Invalid Task")
  );
  assert.throws(() => buildIntegrationBranch("../git-tree-orchestration"));
});

test("orchestration barrel exports the foundation helpers", async () => {
  const {
    buildSpecBranch,
    buildTaskSpecPath,
    canTransitionRun,
    isMergeBlockingTaskStatus,
  } = await import("../../lib/orchestrations");

  assert.equal(
    buildSpecBranch("git-tree-orchestration"),
    "mogplex/spec/git-tree-orchestration"
  );
  assert.equal(
    buildTaskSpecPath("git-tree-orchestration", 1, "validation"),
    "specs/git-tree-orchestration/tasks/1-validation.md"
  );
  assert.equal(canTransitionRun("failed", "failed"), true);
  assert.equal(isMergeBlockingTaskStatus("cancelled"), false);
});
