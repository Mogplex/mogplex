import { loadOwnedSandboxRouteContext } from "@/lib/sandbox/route-context";
import { buildAutofixSandboxInternalApiHeaders } from "./automation-job-sandbox-setup";
import type { AutomationSandboxRef, JobContext } from "./automation-job-types";
import { readFlowReports } from "./flow-report-handoff";
import { materializeFlowReports } from "./flow-report-tools";

export async function prepareHarnessFlowReports(
  context: JobContext,
  ref: AutomationSandboxRef
) {
  if (readFlowReports(context.metadata).length === 0) return;
  const result = await loadOwnedSandboxRouteContext(
    new Request(
      `https://internal.mogplex/api/sandbox/${ref.recordId}/flow-reports`,
      {
        headers: buildAutofixSandboxInternalApiHeaders(context),
      }
    ),
    ref.recordId,
    {
      select:
        "sandbox_id, root_directory, billing_source, billing_team_id, billing_project_id, vercel_team_id, vercel_project_id, repo:repos(root_directory)",
      hydrateSandboxClient: true,
    }
  );
  if (!result.ok) throw new Error(result.error);
  const sandbox = result.sandbox;
  if (!sandbox) throw new Error("Flow report workspace is not ready");
  await materializeFlowReports(context, async (path, text) => {
    await sandbox.writeFiles([{ path, content: Buffer.from(text, "utf8") }]);
  });
}
