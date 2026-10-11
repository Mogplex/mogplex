import { buildInternalApiHeaders } from "@/lib/internal-api-auth";
import { MogplexApiRunControlError } from "./run-control-error";

const SANDBOX_CANCEL_ROUTE_SELECT =
  "sandbox_id, billing_source, billing_team_id, billing_project_id, vercel_team_id, vercel_project_id";

export async function killRuntimeCommand(input: {
  user_id: string;
  sandbox_record_id: string | null;
  runtimeCommandId: string;
}) {
  if (!input.sandbox_record_id) {
    throw new MogplexApiRunControlError(
      "BAD_REQUEST",
      "Run has no sandbox metadata",
      400
    );
  }

  const request = new Request("https://internal.mogplex/api/sandbox/cancel", {
    headers: buildInternalApiHeaders(input.user_id),
  });
  const { loadOwnedSandboxRouteContext } =
    await import("@/lib/sandbox/route-context");
  const sandboxData = await loadOwnedSandboxRouteContext(
    request,
    input.sandbox_record_id,
    {
      select: SANDBOX_CANCEL_ROUTE_SELECT,
    }
  );
  if (!sandboxData.ok) {
    throw new MogplexApiRunControlError(
      "CONFLICT",
      sandboxData.error,
      sandboxData.status
    );
  }
  if (!sandboxData.sandbox) {
    throw new MogplexApiRunControlError(
      "CONFLICT",
      "Sandbox is not ready",
      409
    );
  }

  const command = await sandboxData.sandbox.getCommand(input.runtimeCommandId);
  const { stopSandboxCommand } = await import("@/lib/sandbox/stop-command");
  await stopSandboxCommand(command);
}
