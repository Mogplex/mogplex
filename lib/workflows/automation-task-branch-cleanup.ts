import { randomUUID } from "node:crypto";
import { deleteEmptyRunBranch } from "@/lib/github/run-branch-cleanup";
import { apiRunBranch } from "./automation-task-sandbox";
import type { JobContext } from "./automation-job-types";

/** Metadata key carrying the branch a task node's sandbox works on. */
export const TASK_WORKING_BRANCH_KEY = "task_working_branch";

const defaultDeps = { deleteBranch: deleteEmptyRunBranch };

/**
 * Run a Flow task node on a fresh `mogplex/task-*` branch, then delete that
 * branch if the node pushed nothing to it and opened no pull request. The
 * sandbox pushes the branch at boot, so without this every task run that
 * changes nothing leaves an empty branch on the repository.
 *
 * Other node roles and API-triggered task runs pass straight through: an API
 * run's caller reads its output from the branch its trigger fixed.
 */
export async function withTaskBranchCleanup<T>(
  context: JobContext,
  githubToken: string | null | undefined,
  run: () => Promise<T>,
  overrides: Partial<typeof defaultDeps> = {}
): Promise<T> {
  if (context.metadata.flow_node_role !== "task" || apiRunBranch(context)) {
    return run();
  }
  const branch = `mogplex/task-${randomUUID()}`;
  context.metadata[TASK_WORKING_BRANCH_KEY] = branch;
  try {
    return await run();
  } finally {
    const [owner, repo] = context.repo.full_name.split("/");
    if (githubToken && owner && repo) {
      const deps = { ...defaultDeps, ...overrides };
      await deps.deleteBranch({
        owner,
        repo,
        baseBranch: context.repo.default_branch || "main",
        branch,
        githubToken,
      });
    }
  }
}
