import assert from "node:assert/strict";
import test from "node:test";
import {
  buildControlResourceContextPayload,
  buildControlResourceMetadataPatch,
  createToolCallFinishPayload,
  createToolCallStartPayload,
  summarizeToolCalls,
} from "../../app/api/control/chat/_lib/telemetry";

test("control resource context telemetry preserves server-owned identity boundaries", () => {
  const payload = buildControlResourceContextPayload({
    scope: {
      conversationId: "conversation-1",
      repoId: "repo-1",
      missionId: "mission-1",
    },
    sandboxContext: {
      decisionSource: "server_validated_request",
      rejectionReason: null,
      selected: {
        recordId: "sandbox-record-1",
        runtimeId: "sbx-provider-1",
      },
      sandboxes: [
        { id: "sandbox-record-1", branch: "main", status: "running" },
      ],
    },
    worktreeContext: {
      controlSessionId: "mission-1",
      orchestrationRunId: "run-1",
      decisionSource: "owned_control_session",
      rejectionReason: null,
      worktrees: [
        {
          id: "worktree-1",
          taskId: "task-1",
          branch: "feat/one",
          status: "active",
          sandboxId: "sandbox-record-1",
          checkoutPath: "/repo/.worktrees/worktree-1",
        },
      ],
    },
  });

  assert.equal(payload.sandbox.record_id, "sandbox-record-1");
  assert.equal(payload.sandbox.runtime_id, "sbx-provider-1");
  assert.deepEqual(payload.worktrees.items[0], {
    worktree_id: "worktree-1",
    task_id: "task-1",
    sandbox_record_id: "sandbox-record-1",
    checkout_path: "/repo/.worktrees/worktree-1",
  });
  assert.deepEqual(buildControlResourceMetadataPatch(payload), {
    sandbox_id: "sandbox-record-1",
    sandbox_runtime_id: "sbx-provider-1",
    sandbox_selection_source: "server_validated_request",
    sandbox_rejection_reason: null,
    mission_id: "mission-1",
    orchestration_run_id: "run-1",
  });
});

test("tool completion telemetry adds a scoreable resource decision without copying command output", () => {
  const finished = createToolCallFinishPayload(
    {
      success: true,
      toolCall: {
        toolCallId: "tool-call-1",
        toolName: "run_command",
        input: { command: "cat customer-source.ts" },
      },
      output: {
        exitCode: 0,
        stdout: "private customer source",
        sandboxId: "sandbox-record-1",
        sandboxResolution: "selected",
      },
    },
    {
      repoId: "repo-1",
      missionId: "mission-1",
      orchestrationRunId: "run-1",
      selectedSandboxId: "sandbox-record-1",
    }
  );

  const decision = finished.payload.resource_decision;
  assert.deepEqual(decision, {
    schema_version: 1,
    kind: "orchestrator_resource_decision",
    action: "run_command",
    outcome: "accepted",
    decision_source: "selected",
    rejection_reason: null,
    repo_id: "repo-1",
    mission_id: "mission-1",
    orchestration_run_id: "run-1",
    sandbox_record_id: "sandbox-record-1",
    worktree_id: null,
    task_id: null,
    checkout_path: null,
  });
  assert.doesNotMatch(JSON.stringify(decision), /customer-source|private/);
  assert.equal("resource_payload_omitted" in finished.payload, true);
  assert.equal("input" in finished.payload, false);
  assert.equal("output" in finished.payload, false);
});

test("resource tool start and completion summaries omit prompts, commands, code, and output", () => {
  const started = createToolCallStartPayload(
    {
      toolCall: {
        toolCallId: "tool-call-3",
        toolName: "spawn_subagent",
        input: {
          worktreeId: "worktree-1",
          taskPrompt: "private customer instructions",
        },
      },
    },
    "mission-1"
  );
  assert.deepEqual(started, {
    tool_call_id: "tool-call-3",
    resource_payload_omitted: true,
    step_number: null,
    mission_id: "mission-1",
  });

  const summary = summarizeToolCalls([
    {
      toolCalls: [
        {
          toolName: "write_file",
          input: { path: "secret.ts", content: "private source" },
        },
      ],
      toolResults: [{ ok: true, path: "secret.ts" }],
    },
  ]);
  assert.deepEqual(summary, [
    { name: "write_file", resource_payload_omitted: true },
  ]);
  assert.doesNotMatch(JSON.stringify({ started, summary }), /private|secret/);
});

test("tool completion telemetry records structured mismatch reasons", () => {
  const finished = createToolCallFinishPayload(
    {
      success: true,
      toolCall: {
        toolCallId: "tool-call-2",
        toolName: "spawn_worktree",
        input: { taskId: "invented-task" },
      },
      output: {
        status: "error",
        error: "Human-facing text can change.",
        reason: "task_not_found",
      },
    },
    {
      repoId: "repo-1",
      missionId: "mission-1",
      orchestrationRunId: "run-1",
      selectedSandboxId: "sandbox-record-1",
    }
  );

  assert.deepEqual(finished.payload.resource_decision, {
    schema_version: 1,
    kind: "orchestrator_resource_decision",
    action: "worktree_spawn",
    outcome: "rejected",
    decision_source: "server_selected",
    rejection_reason: "task_not_found",
    repo_id: "repo-1",
    mission_id: "mission-1",
    orchestration_run_id: "run-1",
    sandbox_record_id: "sandbox-record-1",
    worktree_id: null,
    task_id: "invented-task",
    checkout_path: null,
  });
});
