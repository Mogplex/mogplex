import { randomUUID } from "node:crypto";
import { loadOwnedSandboxRouteContext } from "@/lib/sandbox/route-context";
import { resolveSandboxGitAuthor } from "@/lib/sandbox/git-author";
import { prepareTaskWorkspace } from "./automation-task-workspace";
import type { AutofixSandboxRecord, JobContext } from "./automation-job-types";
import {
  buildAutofixSandboxInternalApiHeaders,
  launchAutomationHarnessSandbox,
} from "./automation-job-sandbox-setup";

const AUTOMATION_BRANCH_PATTERN = /^mogplex\/automation-[a-f0-9]{16}$/;

/**
 * The branch a task run works on. An API-triggered run uses the branch fixed
 * when it was triggered, so a retry of the same run returns to the same work
 * and the caller can read its output from a known place. Other task runs get
 * a fresh branch.
 */
export function taskWorkingBranch(context: Pick<JobContext, "metadata">) {
  const recorded = context.metadata.working_branch;
  return typeof recorded === "string" &&
    AUTOMATION_BRANCH_PATTERN.test(recorded)
    ? recorded
    : `mogplex/task-${randomUUID()}`;
}

export function createTaskSandboxLoader(
  context: JobContext,
  githubToken: string
) {
  let loaded: ReturnType<typeof loadSandbox> | undefined;
  async function loadSandbox() {
    const ref = await launchAutomationHarnessSandbox(context, {
      workingBranch: taskWorkingBranch(context),
      createBranch: true,
    });
    context.metadata.sandbox_record_id = ref.recordId;
    context.metadata.sandbox_id = ref.sandboxId;
    const result = await loadOwnedSandboxRouteContext<AutofixSandboxRecord>(
      new Request(`https://internal.mogplex/api/sandbox/${ref.recordId}/task`, {
        headers: buildAutofixSandboxInternalApiHeaders(context),
      }),
      ref.recordId,
      {
        select:
          "repo_id, sandbox_id, root_directory, billing_source, billing_team_id, billing_project_id, vercel_team_id, vercel_project_id, preview_url, repo:repos(full_name, root_directory, sandbox_env_vars, env_sync_mode, vercel_project_id, vercel_team_id, github_installation_id)",
        hydrateSandboxClient: true,
      }
    );
    if (!result.ok) throw new Error(result.error);
    if (!result.sandbox) throw new Error("Task workspace is not ready");
    await prepareTaskWorkspace(result.sandbox, {
      cwd: result.rootDirectory ?? undefined,
      githubToken,
      author: await resolveSandboxGitAuthor(context.repo.user_id),
    });
    return { sandbox: result.sandbox, cwd: result.rootDirectory ?? undefined };
  }
  return () => (loaded ??= loadSandbox());
}
