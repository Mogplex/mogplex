import { buildInternalApiHeaders } from "@/lib/internal-api-auth";
import { loadOwnedSandboxRouteContext } from "@/lib/sandbox/route-context";
import {
  renewSandboxActivityLease,
  SANDBOX_AGENT_EXECUTION_LEASE_MS,
} from "@/lib/sandbox/activity-lease";
import type { ExternalAgentRunRow } from "./runs-types";
import type { SandboxRef } from "./run-execution-launch";
import type { Sandbox } from "@vercel/sandbox";
import type {
  SandboxRouteFailure,
  SandboxRouteRecordLike,
} from "@/lib/sandbox/route-context";

type LeaseDeps = {
  loadContext: (
    ...args: Parameters<typeof loadOwnedSandboxRouteContext>
  ) => Promise<
    | SandboxRouteFailure
    | { ok: true; record: SandboxRouteRecordLike; sandbox: Sandbox | null }
  >;
  renewLease: typeof renewSandboxActivityLease;
};

const defaultDeps: LeaseDeps = {
  loadContext: loadOwnedSandboxRouteContext,
  renewLease: renewSandboxActivityLease,
};

/** Reserve VM lifetime before native model/tool work, not in response to logs. */
export async function ensureNativeRunExecutionLease(
  run: ExternalAgentRunRow,
  sandbox: SandboxRef,
  teamId: string | null,
  deps = defaultDeps
): Promise<void> {
  const loaded = await deps.loadContext(
    new Request("https://internal.mogplex/api/sandbox/execution-lease", {
      headers: buildInternalApiHeaders(run.user_id, { teamId }),
    }),
    sandbox.recordId,
    {
      select:
        "id, user_id, repo_id, sandbox_id, working_branch, status, product_team_id, billing_source, billing_project_id, billing_team_id, vercel_project_id, vercel_team_id",
      requireCapability: "tools.bash",
      includeAi: false,
    }
  );
  if (!loaded.ok) throw new Error(loaded.error);
  if (
    !loaded.sandbox ||
    loaded.record.id !== sandbox.recordId ||
    loaded.record.status !== "running" ||
    loaded.record.user_id !== run.user_id ||
    loaded.record.repo_id !== run.repo_id ||
    (loaded.record.product_team_id ?? null) !== teamId ||
    loaded.record.working_branch !== run.working_branch ||
    loaded.record.sandbox_id !== sandbox.sandboxId ||
    loaded.sandbox.status !== "running"
  ) {
    throw new Error("Active sandbox not found for this agent run");
  }
  await deps.renewLease(
    loaded.sandbox,
    undefined,
    SANDBOX_AGENT_EXECUTION_LEASE_MS
  );
}
