import { buildInternalApiHeaders } from "@/lib/internal-api-auth";
import type { SandboxCommandExecution } from "@/lib/agents/tools/sandbox";
import type { SandboxExecPostDeps } from "@/lib/sandbox/exec/_lib/types";

export function createNativeSandboxExecution(
  userId: string,
  teamId: string | null,
  overrides: Partial<SandboxExecPostDeps> = {},
  signal?: AbortSignal
): SandboxCommandExecution {
  const pending = new Map<string, Promise<unknown>>();
  return {
    retryOnSandboxLoss: false,
    execute: (sandboxId, _headers, body) => {
      // Models can emit several bash calls in one step. Sequence them through
      // the existing per-sandbox lock without replaying any command.
      const result = (pending.get(sandboxId) ?? Promise.resolve()).then(
        async () => {
          signal?.throwIfAborted();
          // Keep command completion in the durable worker instead of a second
          // HTTP invocation. Reuse the route's authorization, billing and locks.
          const { createSandboxExecPostHandler } =
            await import("@/lib/sandbox/exec/route");
          return createSandboxExecPostHandler(overrides)(
            new Request(
              `https://internal.mogplex/api/sandbox/${sandboxId}/exec`,
              {
                method: "POST",
                headers: buildInternalApiHeaders(userId, { teamId }),
                body: JSON.stringify(body),
                signal,
              }
            ),
            { params: Promise.resolve({ id: sandboxId }) }
          );
        }
      );
      const settled = result.catch(() => undefined);
      pending.set(sandboxId, settled);
      void settled.then(() => {
        if (pending.get(sandboxId) === settled) pending.delete(sandboxId);
      });
      return result;
    },
  };
}
