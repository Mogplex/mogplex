import {
  acquireSandboxExecLock,
  releaseSandboxExecLock,
} from "@/lib/request-limits";

export type SandboxMutationLockDeps = {
  acquireSandboxExecLock: typeof acquireSandboxExecLock;
  releaseSandboxExecLock: typeof releaseSandboxExecLock;
};
const defaultDeps = { acquireSandboxExecLock, releaseSandboxExecLock };

// Share the command lock with file mutations and guarded shutdown. In
// particular, a clean Git inspection must stay valid until shutdown finishes.
export async function withSandboxMutationLock(
  sandboxId: string,
  operation: () => Promise<Response>,
  deps: SandboxMutationLockDeps = defaultDeps
): Promise<Response> {
  const lock = await deps.acquireSandboxExecLock(sandboxId);
  if (!lock.acquired) {
    return Response.json(
      {
        error:
          "A sandbox command, file edit, or shutdown is in progress. Retry when it finishes.",
        reason: "sandbox_busy",
      },
      { status: 409 }
    );
  }
  try {
    return await operation();
  } finally {
    await deps.releaseSandboxExecLock(sandboxId, lock.token);
  }
}
