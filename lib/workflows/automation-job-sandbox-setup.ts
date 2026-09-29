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

export async function launchAutofixSandbox(input: {
  context: JobContext;
  pullRequest: PullRequestDetails;
  targetRepo: JobContext["repo"];
}) {
  "use step";

  return launchSandboxInternally({
    headers: buildAutofixSandboxInternalApiHeaders(input.context),
    body: {
      repoId: input.targetRepo.id,
      baseBranch:
        input.pullRequest.baseRef ||
        input.targetRepo.default_branch ||
        input.context.repo.default_branch ||
        "main",
      workingBranch: input.pullRequest.headRef,
      createBranch: false,
    },
  });
}

export async function launchAutomationHarnessSandbox(
  context: JobContext,
  branch?: { workingBranch: string; createBranch: boolean }
) {
  "use step";

  const baseBranch = context.repo.default_branch || "main";
  return launchSandboxInternally({
    headers: buildAutofixSandboxInternalApiHeaders(context),
    body: {
      repoId: context.repo.id,
      baseBranch,
      workingBranch: branch?.workingBranch ?? baseBranch,
      createBranch: branch?.createBranch ?? false,
    },
  });
}
