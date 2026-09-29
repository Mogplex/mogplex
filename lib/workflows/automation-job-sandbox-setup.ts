/**
 * Sandbox setup and launch helpers for the automation job workflow.
 * Split from automation-job-sandbox.ts for modularity.
 */

import { buildInternalApiHeaders } from "@/lib/internal-api-auth";
import { launchSandboxInternally } from "@/lib/sandbox/internal-launch";
import type {
  JobContext,
  PullRequestDetails,
} from "@/lib/workflows/automation-job-types";
import { readAutomationTeamId } from "@/lib/workflows/automation-job-utils";

export function buildAutofixSandboxInternalApiHeaders(
  context: Pick<JobContext, "metadata" | "repo">
) {
  return buildInternalApiHeaders(context.repo.user_id, {
    teamId: readAutomationTeamId(context.metadata),
  });
}

type RepoBranch = Pick<JobContext["repo"], "id" | "default_branch">;

/** The sandbox route body for an autofix: the pull request's head branch. */
export function autofixSandboxLaunchBody(input: {
  contextRepo: Pick<JobContext["repo"], "default_branch">;
  pullRequest: Pick<PullRequestDetails, "baseRef" | "headRef">;
  targetRepo: RepoBranch;
}) {
  return {
    repoId: input.targetRepo.id,
    baseBranch:
      input.pullRequest.baseRef ||
      input.targetRepo.default_branch ||
      input.contextRepo.default_branch ||
      "main",
    workingBranch: input.pullRequest.headRef,
    createBranch: false,
  };
}

/** The sandbox route body for an automation harness run. */
export function automationHarnessSandboxLaunchBody(
  repo: RepoBranch,
  branch?: { workingBranch: string; createBranch: boolean }
) {
  const baseBranch = repo.default_branch || "main";
  return {
    repoId: repo.id,
    baseBranch,
    workingBranch: branch?.workingBranch ?? baseBranch,
    createBranch: branch?.createBranch ?? false,
  };
}

export async function launchAutofixSandbox(input: {
  context: JobContext;
  pullRequest: PullRequestDetails;
  targetRepo: JobContext["repo"];
}) {
  "use step";

  return launchSandboxInternally({
    headers: buildAutofixSandboxInternalApiHeaders(input.context),
    body: autofixSandboxLaunchBody({
      contextRepo: input.context.repo,
      pullRequest: input.pullRequest,
      targetRepo: input.targetRepo,
    }),
  });
}

export async function launchAutomationHarnessSandbox(
  context: JobContext,
  branch?: { workingBranch: string; createBranch: boolean }
) {
  "use step";

  return launchSandboxInternally({
    headers: buildAutofixSandboxInternalApiHeaders(context),
    body: automationHarnessSandboxLaunchBody(context.repo, branch),
  });
}
