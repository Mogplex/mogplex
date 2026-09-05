import { buildInternalApiHeaders } from "@/lib/internal-api-auth";
import type { SandboxCommandExecution } from "@/lib/agents/tools/sandbox";
import type { SandboxExecPostDeps } from "@/app/api/sandbox/[id]/exec/_lib/types";

export function createNativeSandboxExecution(
  userId: string,
  teamId: string | null,
  overrides: Partial<SandboxExecPostDeps> = {}
): SandboxCommandExecution {
  return {
    retryOnSandboxLoss: false,
    execute: async (sandboxId, _headers, body) => {
      // Keep command completion in the durable worker instead of a second
      // HTTP invocation. Reuse the route's authorization, billing and locks.
      const { createSandboxExecPostHandler } =
        await import("@/app/api/sandbox/[id]/exec/route");
      return createSandboxExecPostHandler(overrides)(
        new Request(`https://internal.mogplex/api/sandbox/${sandboxId}/exec`, {
          method: "POST",
          headers: buildInternalApiHeaders(userId, { teamId }),
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ id: sandboxId }) }
      );
    },
  };
}
