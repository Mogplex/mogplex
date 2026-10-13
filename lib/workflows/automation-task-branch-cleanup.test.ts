import { describe, expect, it } from "vitest";
import { withTaskBranchCleanup } from "./automation-task-branch-cleanup";
import { taskWorkingBranch } from "./automation-task-sandbox";
import type { JobContext } from "./automation-job-types";

function context(metadata: Record<string, unknown>): JobContext {
  return {
    repo: {
      id: "repo-1",
      user_id: "user-1",
      full_name: "webrenew/vmotif",
      default_branch: "main",
    },
    metadata,
  } as unknown as JobContext;
}

describe("withTaskBranchCleanup", () => {
  it("should run a task node on the branch it assigns, then clean that branch up", async () => {
    const task = context({ flow_node_role: "task" });
    const deleted: Array<{ branch: string; baseBranch: string }> = [];
    let usedBranch = "";
    await withTaskBranchCleanup(
      task,
      "token",
      async () => {
        usedBranch = taskWorkingBranch(task);
      },
      {
        deleteBranch: async (input) => {
          deleted.push({ branch: input.branch, baseBranch: input.baseBranch });
          return "deleted";
        },
      }
    );
    expect(usedBranch).toMatch(/^mogplex\/task-[\da-f-]{36}$/);
    expect(deleted).toEqual([{ branch: usedBranch, baseBranch: "main" }]);
  });

  it("should clean up even when the task fails", async () => {
    const task = context({ flow_node_role: "task" });
    const deleted: string[] = [];
    await expect(
      withTaskBranchCleanup(
        task,
        "token",
        async () => {
          throw new Error("agent crashed");
        },
        {
          deleteBranch: async (input) => {
            deleted.push(input.branch);
            return "deleted";
          },
        }
      )
    ).rejects.toThrow("agent crashed");
    expect(deleted).toHaveLength(1);
  });

  it.each([
    ["a review node", { flow_node_role: "review" }],
    [
      "an API-triggered task",
      {
        flow_node_role: "task",
        working_branch: "mogplex/automation-0123456789abcdef",
      },
    ],
  ])("should leave %s untouched", async (_label, metadata) => {
    const node = context(metadata);
    let attempted = false;
    const result = await withTaskBranchCleanup(node, "token", async () => 42, {
      deleteBranch: async () => {
        attempted = true;
        return "deleted";
      },
    });
    expect(result).toBe(42);
    expect(attempted).toBe(false);
    expect(node.metadata.task_working_branch).toBeUndefined();
  });
});

describe("taskWorkingBranch", () => {
  it("should prefer the branch an API trigger fixed", () => {
    expect(
      taskWorkingBranch({
        metadata: {
          working_branch: "mogplex/automation-0123456789abcdef",
          task_working_branch: "mogplex/task-1",
        },
      })
    ).toBe("mogplex/automation-0123456789abcdef");
  });

  it("should ignore an assigned branch outside the task namespace", () => {
    expect(
      taskWorkingBranch({ metadata: { task_working_branch: "main" } })
    ).toMatch(/^mogplex\/task-/);
  });
});
