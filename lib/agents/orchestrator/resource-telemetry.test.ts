import { describe, expect, it } from "vitest";
import {
  buildResourceContextTelemetry,
  buildResourceDecisionTelemetry,
} from "./resource-telemetry";

const RESOURCE_SCOPE = {
  repoId: "repo-1",
  missionId: "mission-1",
  orchestrationRunId: "run-1",
  selectedSandboxId: "sandbox-record-1",
};

describe("orchestrator resource telemetry", () => {
  it("distinguishes sandbox records, provider runtimes, tasks, worktrees, and checkout paths", () => {
    expect(
      buildResourceContextTelemetry({
        scope: RESOURCE_SCOPE,
        sandbox: {
          decisionSource: "server_validated_request",
          rejectionReason: null,
          recordId: "sandbox-record-1",
          runtimeId: "sbx-provider-1",
        },
        worktrees: {
          decisionSource: "owned_control_session",
          rejectionReason: null,
          total: 2,
          items: [
            {
              worktreeId: "worktree-1",
              taskId: "task-1",
              sandboxRecordId: "sandbox-record-1",
              checkoutPath: "/repo/.worktrees/worktree-1",
            },
            {
              worktreeId: "worktree-2",
              taskId: "task-2",
              sandboxRecordId: "sandbox-record-1",
              checkoutPath: "/repo/.worktrees/worktree-2",
            },
          ],
        },
      })
    ).toEqual({
      schema_version: 1,
      kind: "orchestrator_resource_context",
      repo_id: "repo-1",
      mission_id: "mission-1",
      orchestration_run_id: "run-1",
      sandbox: {
        decision_source: "server_validated_request",
        rejection_reason: null,
        record_id: "sandbox-record-1",
        runtime_id: "sbx-provider-1",
      },
      worktrees: {
        decision_source: "owned_control_session",
        rejection_reason: null,
        total: 2,
        truncated: false,
        items: [
          {
            worktree_id: "worktree-1",
            task_id: "task-1",
            sandbox_record_id: "sandbox-record-1",
            checkout_path: "/repo/.worktrees/worktree-1",
          },
          {
            worktree_id: "worktree-2",
            task_id: "task-2",
            sandbox_record_id: "sandbox-record-1",
            checkout_path: "/repo/.worktrees/worktree-2",
          },
        ],
      },
    });
  });

  it("records sandbox-only preview and command decisions without implying a worktree", () => {
    expect(
      buildResourceDecisionTelemetry(
        {
          success: true,
          toolCall: {
            toolName: "sandbox_start",
            input: { repoId: "repo-1" },
          },
          output: {
            ok: true,
            sandboxId: "sandbox-record-1",
            sandboxResolution: "created",
          },
        },
        RESOURCE_SCOPE
      )
    ).toMatchObject({
      action: "sandbox_start",
      outcome: "accepted",
      decision_source: "created",
      sandbox_record_id: "sandbox-record-1",
      worktree_id: null,
      task_id: null,
      checkout_path: null,
    });

    expect(
      buildResourceDecisionTelemetry(
        {
          success: true,
          toolCall: {
            toolName: "run_command",
            input: { command: "pnpm test" },
          },
          output: {
            exitCode: 0,
            stdout: "customer output that must not be copied",
            sandboxId: "sandbox-record-1",
            sandboxResolution: "selected",
          },
        },
        RESOURCE_SCOPE
      )
    ).toEqual({
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
  });

  it("records the exact selected sandbox, task, worktree, and checkout for isolated coding", () => {
    const worktree = {
      id: "worktree-1",
      task_id: "task-1",
      sandbox_id: "sandbox-record-1",
      checkout_path: "/repo/.worktrees/worktree-1",
    };

    expect(
      buildResourceDecisionTelemetry(
        {
          success: true,
          toolCall: {
            toolName: "spawn_worktree",
            input: { taskId: "task-1" },
          },
          output: { status: "ok", worktree },
        },
        RESOURCE_SCOPE
      )
    ).toMatchObject({
      action: "worktree_spawn",
      outcome: "accepted",
      decision_source: "server_selected",
      sandbox_record_id: "sandbox-record-1",
      worktree_id: "worktree-1",
      task_id: "task-1",
      checkout_path: "/repo/.worktrees/worktree-1",
    });

    const workerDecision = buildResourceDecisionTelemetry(
      {
        success: true,
        toolCall: {
          toolName: "spawn_subagent",
          input: {
            worktreeId: "worktree-1",
            taskPrompt: "customer prompt that must not be copied",
          },
        },
        output: { status: "ok", worktree },
      },
      RESOURCE_SCOPE
    );
    expect(workerDecision).toMatchObject({
      action: "worker_spawn",
      decision_source: "persisted_worktree_binding",
      sandbox_record_id: "sandbox-record-1",
      worktree_id: "worktree-1",
      task_id: "task-1",
      checkout_path: "/repo/.worktrees/worktree-1",
    });
    expect(JSON.stringify(workerDecision)).not.toContain("customer prompt");
  });

  it("keeps sandbox and worktree lifecycle decisions separate", () => {
    const stopped = buildResourceDecisionTelemetry(
      {
        success: true,
        toolCall: {
          toolName: "sandbox_stop",
          input: { sandboxId: "sandbox-record-1" },
        },
        output: {
          ok: true,
          sandboxId: "sandbox-record-1",
          status: "stopped",
        },
      },
      RESOURCE_SCOPE
    );
    expect(stopped).toMatchObject({
      action: "sandbox_stop",
      sandbox_record_id: "sandbox-record-1",
      worktree_id: null,
    });

    for (const [toolName, action] of [
      ["archive_worktree", "worktree_archive"],
      ["prune_worktree", "worktree_prune"],
    ] as const) {
      expect(
        buildResourceDecisionTelemetry(
          {
            success: true,
            toolCall: {
              toolName,
              input: { worktreeId: "worktree-1" },
            },
            output: {
              status: "ok",
              worktree: {
                id: "worktree-1",
                task_id: "task-1",
                sandbox_id: "sandbox-record-1",
                checkout_path: "/repo/.worktrees/worktree-1",
              },
            },
          },
          RESOURCE_SCOPE
        )
      ).toMatchObject({
        action,
        decision_source: "persisted_worktree_binding",
        sandbox_record_id: "sandbox-record-1",
        worktree_id: "worktree-1",
      });
    }
  });

  it("exposes stable mismatch reasons instead of requiring downstream prose parsing", () => {
    const decision = buildResourceDecisionTelemetry(
      {
        success: true,
        toolCall: {
          toolName: "spawn_worktree",
          input: { taskId: "client-invented-task" },
        },
        output: {
          status: "error",
          error: "This message may change without breaking scorers.",
          reason: "mission_mismatch",
        },
      },
      RESOURCE_SCOPE
    );

    expect(decision).toMatchObject({
      outcome: "rejected",
      rejection_reason: "mission_mismatch",
      sandbox_record_id: "sandbox-record-1",
      worktree_id: null,
      task_id: "client-invented-task",
    });
    expect(JSON.stringify(decision)).not.toContain("This message may change");
  });

  it("ignores tools that do not select or mutate execution resources", () => {
    expect(
      buildResourceDecisionTelemetry(
        {
          success: true,
          toolCall: { toolName: "web_fetch", input: { url: "https://x" } },
          output: { text: "content" },
        },
        RESOURCE_SCOPE
      )
    ).toBeNull();
  });

  it("bounds worktree context without losing the total", () => {
    const items = Array.from({ length: 51 }, (_, index) => ({
      worktreeId: `worktree-${index}`,
      taskId: `task-${index}`,
      sandboxRecordId: "sandbox-record-1",
      checkoutPath: `/repo/.worktrees/worktree-${index}`,
    }));
    const context = buildResourceContextTelemetry({
      scope: RESOURCE_SCOPE,
      sandbox: {
        decisionSource: "server_validated_request",
        rejectionReason: null,
        recordId: "sandbox-record-1",
        runtimeId: "sbx-provider-1",
      },
      worktrees: {
        decisionSource: "owned_control_session",
        rejectionReason: null,
        total: items.length,
        items,
      },
    });

    expect(context.worktrees.total).toBe(51);
    expect(context.worktrees.items).toHaveLength(50);
    expect(context.worktrees.truncated).toBe(true);
  });
});
