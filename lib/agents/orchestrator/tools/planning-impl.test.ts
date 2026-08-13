import { describe, expect, it } from "vitest";
import type { OrchestrationWorktreeDTO } from "@/lib/worktrees/types";
import type {
  OrchestrationRunDTO,
  OrchestrationSpecDTO,
  OrchestrationTaskDTO,
} from "@/lib/orchestrations/types";
import type { OrchestratorToolContext } from "../types";
import {
  createPlanMissionTool,
  createSpawnSubagentTool,
} from "./planning-impl";

type ExecutableTool = {
  execute: (input: Record<string, unknown>) => Promise<unknown>;
};

const RUN_ID = "11111111-2222-4333-8444-555555555555";
const REPO_ID = "22222222-2222-4222-8222-222222222222";
const TASK_ID = "33333333-3333-4333-8333-333333333333";
const WORKTREE_ID = "44444444-4444-4444-8444-444444444444";

const ctx: OrchestratorToolContext = {
  userId: "user-1",
  repoId: REPO_ID,
  orchestrationRunId: RUN_ID,
  conversationId: "conversation-1",
  workspaceSessionId: "session-1",
  aiCallId: "call-1",
  controlMode: "run",
};

function buildRun(): OrchestrationRunDTO {
  return {
    id: RUN_ID,
    user_id: "user-1",
    workspace_id: null,
    repo_id: REPO_ID,
    title: "Separate worktrees",
    slug: "separate-worktrees",
    status: "drafting_master_spec",
    request: "Separate worktrees from sandboxes",
    base_branch: "main",
    root_directory: null,
    spec_branch: "mogplex/spec/separate-worktrees",
    integration_branch: "mogplex/integrate/separate-worktrees",
    approval_mode: "manual",
    master_spec_path: null,
    master_spec_blob_sha: null,
    planner_sandbox_id: null,
    integration_sandbox_id: null,
    github_pr_number: null,
    github_pr_url: null,
    error: null,
    metadata: {},
    created_at: "2026-08-13T00:00:00.000Z",
    updated_at: "2026-08-13T00:00:00.000Z",
  };
}

function buildSpec(index: number, slug: string): OrchestrationSpecDTO {
  return {
    id: `55555555-5555-4555-8555-55555555555${index}`,
    run_id: RUN_ID,
    kind: "task",
    order_index: index,
    slug,
    title: slug,
    status: "draft",
    file_path: `specs/separate-worktrees/tasks/${index}-${slug}.md`,
    blob_sha: null,
    branch_name: `mogplex/task/separate-worktrees/${slug}`,
    owned_paths: [],
    blocked_paths: [],
    depends_on: [],
    acceptance_criteria: [],
    validation_commands: [],
    prompt: null,
    metadata: {},
  };
}

function buildTask(
  index: number,
  spec: OrchestrationSpecDTO
): OrchestrationTaskDTO {
  return {
    id: `66666666-6666-4666-8666-66666666666${index}`,
    run_id: RUN_ID,
    spec_id: spec.id,
    repo_id: REPO_ID,
    agent_id: null,
    harness: "codex",
    sandbox_id: null,
    branch_name: spec.branch_name!,
    base_branch: "main",
    root_directory: null,
    status: "planned",
    latest_commit_sha: null,
    pushed_at: null,
    validation_status: null,
    validation_summary: null,
    error: null,
    metadata: {},
    created_at: "2026-08-13T00:00:00.000Z",
    updated_at: "2026-08-13T00:00:00.000Z",
  };
}

function buildWorktree(): OrchestrationWorktreeDTO {
  return {
    id: WORKTREE_ID,
    user_id: "user-1",
    run_id: RUN_ID,
    task_id: TASK_ID,
    repo_id: REPO_ID,
    sandbox_id: "77777777-7777-4777-8777-777777777777",
    agent_id: null,
    branch_name: "mogplex/task/separate-worktrees/code",
    base_branch: "main",
    checkout_path: `/vercel/sandbox/.worktrees/${WORKTREE_ID}`,
    status: "active",
    latest_commit_sha: null,
    error: null,
    metadata: {},
    created_at: "2026-08-13T00:00:00.000Z",
    updated_at: "2026-08-13T00:00:00.000Z",
    archived_at: null,
    pruned_at: null,
  };
}

describe("planning tools", () => {
  it("persists task specs and returns task IDs that can receive worktrees", async () => {
    const tasks: OrchestrationTaskDTO[] = [];
    const plans: Array<{
      objective: string;
      tasks: Array<{ slug: string; branchName: string; filePath: string }>;
    }> = [];
    const tool = createPlanMissionTool(ctx, {
      getRunDetails: async () => ({
        run: buildRun(),
        specs: [],
        tasks: [],
        events: [],
        mergeEvents: [],
      }),
      createPlan: async (input) => {
        plans.push({
          objective: input.objective,
          tasks: input.tasks.map((task) => ({
            slug: task.slug,
            branchName: task.branchName,
            filePath: task.filePath,
          })),
        });
        for (const taskInput of input.tasks) {
          const spec = buildSpec(taskInput.orderIndex, taskInput.slug);
          tasks.push(buildTask(tasks.length, spec));
        }
        return tasks;
      },
    }) as unknown as ExecutableTool;

    const result = (await tool.execute({
      objective: "Separate the concepts",
      tasks: [
        {
          slug: "code",
          title: "Code",
          prompt: "Implement",
          harness: "codex",
          ownedPaths: ["lib"],
        },
        {
          slug: "tests",
          title: "Tests",
          prompt: "Verify",
          harness: "codex",
          ownedPaths: ["tests"],
        },
      ],
    })) as { status: string; tasks: OrchestrationTaskDTO[] };

    expect(result.status).toBe("ok");
    expect(result.tasks).toHaveLength(2);
    expect(plans).toEqual([
      {
        objective: "Separate the concepts",
        tasks: [
          {
            slug: "code",
            branchName: "mogplex/task/separate-worktrees/code",
            filePath: "specs/separate-worktrees/tasks/0-code.md",
          },
          {
            slug: "tests",
            branchName: "mogplex/task/separate-worktrees/tests",
            filePath: "specs/separate-worktrees/tasks/1-tests.md",
          },
        ],
      },
    ]);
    expect(tasks.map((task) => task.branch_name)).toEqual([
      "mogplex/task/separate-worktrees/code",
      "mogplex/task/separate-worktrees/tests",
    ]);
  });

  it("starts a worker with the exact active worktree binding", async () => {
    const starts: Array<Record<string, unknown>> = [];
    const bindings: Array<Record<string, unknown>> = [];
    const tool = createSpawnSubagentTool(ctx, {
      loadWorktree: async () => buildWorktree(),
      bindAgent: async (input) => {
        bindings.push(input);
        return buildWorktree();
      },
      startRun: async (input) => {
        starts.push(input as unknown as Record<string, unknown>);
        return {
          replayed: false,
          run: {
            runId: "99999999-9999-4999-8999-999999999999",
            aiCallId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            worktreeId: WORKTREE_ID,
          },
        } as Awaited<
          ReturnType<typeof import("@/lib/mogplex-api/runs").startMogplexApiRun>
        >;
      },
    }) as unknown as ExecutableTool;

    const result = (await tool.execute({
      worktreeId: WORKTREE_ID,
      taskPrompt: "Implement the task",
      agentType: "codex",
    })) as { status: string };

    expect(result.status).toBe("ok");
    expect(starts[0]).toMatchObject({
      body: {
        repoId: REPO_ID,
        worktreeId: WORKTREE_ID,
        prompt: "Implement the task",
        harness: "codex",
      },
      extraMetadata: {
        orchestrationRunId: RUN_ID,
        orchestrationTaskId: TASK_ID,
        orchestrationWorktreeId: WORKTREE_ID,
      },
    });
    expect(bindings).toEqual([
      {
        worktreeId: WORKTREE_ID,
        userId: "user-1",
        agentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      },
    ]);
  });
});
