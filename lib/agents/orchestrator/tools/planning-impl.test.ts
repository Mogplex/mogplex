import {
  ctx,
  buildRun,
  buildSpec,
  buildTask,
  buildWorktree,
  REPO_ID,
  RUN_ID,
  TASK_ID,
  WORKTREE_ID,
  type ExecutableTool,
} from "../../../../tests/support/control-plan-fixtures";
import { describe, expect, it } from "vitest";
import type { OrchestrationTaskDTO } from "@/lib/orchestrations/types";
import {
  createPlanMissionTool,
  createSpawnSubagentTool,
} from "./planning-impl";

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

  it("runs workers with full sandbox access when the operator skipped permissions", async () => {
    // Codex keeps Git metadata read-only in workspace-write mode, so a worker
    // that cannot commit fails delivery with "untracked files remain".
    const starts: Array<{ body: { mode?: string | null } }> = [];
    const tool = createSpawnSubagentTool(
      { ...ctx, controlPermissions: "Skip Permissions" },
      {
        loadWorktree: async () => buildWorktree(),
        bindAgent: async () => buildWorktree(),
        startRun: async (input) => {
          starts.push(input as unknown as { body: { mode?: string | null } });
          return {
            replayed: false,
            run: {
              runId: "99999999-9999-4999-8999-999999999999",
              aiCallId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              worktreeId: WORKTREE_ID,
            },
          } as Awaited<
            ReturnType<
              typeof import("@/lib/mogplex-api/runs").startMogplexApiRun
            >
          >;
        },
      }
    ) as unknown as ExecutableTool;
    await tool.execute({
      worktreeId: WORKTREE_ID,
      taskPrompt: "Implement the task",
      agentType: "codex",
    });
    expect(starts[0]?.body.mode).toBe("YOLO");
  });

  it("tells the coordinator to send only new tasks for a follow-up", () => {
    const tool = createPlanMissionTool(ctx) as unknown as {
      description: string;
    };
    expect(tool.description).toMatch(/only the new tasks/i);
    expect(tool.description).not.toMatch(/replayed/i);
  });

  it("starts a worker with the exact active worktree binding", async () => {
    const starts: Array<Record<string, unknown>> = [];
    const bindings: Array<Record<string, unknown>> = [];
    const tool = createSpawnSubagentTool(
      { ...ctx, aiCallId: null },
      {
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
            ReturnType<
              typeof import("@/lib/mogplex-api/runs").startMogplexApiRun
            >
          >;
        },
      }
    ) as unknown as ExecutableTool;

    const result = (await tool.execute({
      worktreeId: WORKTREE_ID,
      taskPrompt: "Implement the task",
      agentType: "codex",
    })) as { status: string };

    expect(result.status).toBe("ok");
    expect(starts[0]).toMatchObject({
      idempotencyKey: expect.stringContaining("control:conversation-1:"),
      body: {
        repoId: REPO_ID,
        worktreeId: WORKTREE_ID,
        prompt: "Implement the task",
        harness: "codex",
        mode: "AUTO",
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

it("persists new tasks in an existing thread instead of silently returning its original plan", async () => {
  const spec = buildSpec(0, "old-review");
  const oldTask = buildTask(0, spec);
  const planned: Array<{ slug: string; orderIndex: number; filePath: string }> =
    [];
  const newTask = buildTask(1, buildSpec(1, "follow-up"));
  const tool = createPlanMissionTool(ctx, {
    getRunDetails: async () => ({
      run: buildRun(),
      specs: [spec],
      tasks: [oldTask],
      events: [],
      mergeEvents: [],
    }),
    createPlan: async (input) => {
      planned.push(...input.tasks);
      return [newTask];
    },
  }) as unknown as ExecutableTool;
  const result = await tool.execute({
    objective: "Check the next change",
    tasks: [
      {
        slug: "follow-up",
        title: "Follow-up",
        prompt: "Review the next change",
        harness: "codex",
        ownedPaths: ["docs"],
      },
    ],
  });
  expect(result).toMatchObject({ status: "ok", tasks: [newTask] });
  expect(planned).toMatchObject([
    {
      slug: "follow-up",
      orderIndex: 1,
      filePath: "specs/separate-worktrees/tasks/1-follow-up.md",
    },
  ]);
});
