import { randomUUID } from "node:crypto";
import { loadOwnedSandboxRouteContext } from "@/lib/sandbox/route-context";
import type { AutofixSandboxRecord, JobContext } from "./automation-job-types";
import {
  buildAutofixSandboxInternalApiHeaders,
  launchAutomationHarnessSandbox,
} from "./automation-job-sandbox-setup";

export function createDependabotSandboxLoader(context: JobContext) {
  let loaded: ReturnType<typeof loadSandbox> | undefined;
  async function loadSandbox() {
    const ref = await launchAutomationHarnessSandbox(context, {
      workingBranch: `mogplex/dependabot-${context.metadata.alert_number}-${randomUUID()}`,
      createBranch: true,
    });
    // Retain the workspace identity in success and failure telemetry.
    context.metadata.sandbox_record_id = ref.recordId;
    context.metadata.sandbox_id = ref.sandboxId;
    const result = await loadOwnedSandboxRouteContext<AutofixSandboxRecord>(
      new Request(
        `https://internal.mogplex/api/sandbox/${ref.recordId}/dependabot`,
        {
          headers: buildAutofixSandboxInternalApiHeaders(context),
        }
      ),
      ref.recordId,
      {
        select:
          "repo_id, sandbox_id, root_directory, billing_source, billing_team_id, billing_project_id, vercel_team_id, vercel_project_id, preview_url, repo:repos(full_name, root_directory, sandbox_env_vars, env_sync_mode, vercel_project_id, vercel_team_id, github_installation_id)",
        hydrateSandboxClient: true,
      }
    );
    if (!result.ok) throw new Error(result.error);
    if (!result.sandbox) throw new Error("Dependabot workspace is not ready");
    return { sandbox: result.sandbox, cwd: result.rootDirectory ?? undefined };
  }
  return () => (loaded ??= loadSandbox());
}
