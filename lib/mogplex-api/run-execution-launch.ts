/**
 * Sandbox launch for external agent runs, through the shared internal
 * launcher (`lib/sandbox/internal-launch.ts`). Split out of run-execution.ts to
 * keep that module focused on the run lifecycle.
 */
import { buildInternalApiHeaders } from "@/lib/internal-api-auth";
import { launchSandboxInternally } from "@/lib/sandbox/internal-launch";
import type { ExternalAgentRunRow } from "@/lib/mogplex-api/runs";

export type SandboxRef = {
  recordId: string;
  sandboxId: string | null;
};

export async function readTextResponse(response: Response) {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

export async function launchSandboxViaRoute(run: ExternalAgentRunRow) {
  if (run.sandbox_record_id && run.sandbox_id && run.sandbox_id !== "pending") {
    return {
      recordId: run.sandbox_record_id,
      sandboxId: run.sandbox_id,
    };
  }

  const { recordId, sandboxId } = await launchSandboxInternally({
    headers: buildInternalApiHeaders(run.user_id),
    body: {
      repoId: run.repo_id,
      baseBranch: run.base_branch,
      workingBranch: run.working_branch,
      createBranch: run.create_branch,
      rootDirectory: run.root_directory,
    },
  });
  return { recordId, sandboxId };
}
