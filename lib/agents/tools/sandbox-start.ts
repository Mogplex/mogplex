import { z } from "zod";
import type { ToolExecutionOptions } from "ai";
import { defineTool } from "./shared";
import {
  getSandboxRequestHeaders,
  resolveOrCreateSandbox,
  type SandboxResolution,
} from "./sandbox-resolution";

const startSandboxParams = z.object({
  repoId: z
    .string()
    .describe(
      "The repo UUID (preferred) or GitHub full_name (e.g. 'owner/repo') to launch a sandbox for"
    ),
});
const startServerSelectedSandboxParams = z.object({});

export type SandboxStartLifecycle = {
  onPending?: () => void;
  onResolution?: (resolution: SandboxResolution) => void;
  onFailure?: () => void;
};

function normalizeLifecycle(
  lifecycle?: ((resolution: SandboxResolution) => void) | SandboxStartLifecycle
): SandboxStartLifecycle {
  return typeof lifecycle === "function"
    ? { onResolution: lifecycle }
    : (lifecycle ?? {});
}

export function getSandboxStartMessage(sandbox: SandboxResolution) {
  if (sandbox.status === "pending") {
    return "Sandbox is starting and not yet ready.";
  }
  return sandbox.source === "reused_running"
    ? "Sandbox is already running and ready to use."
    : "Sandbox is ready to use.";
}

async function startSandbox(
  userId: string | undefined,
  repoId: string,
  lifecycle: SandboxStartLifecycle,
  signal?: AbortSignal
) {
  // Fail before repository lookups when the internal sandbox auth is absent.
  const authCheck = getSandboxRequestHeaders(userId);
  if ("error" in authCheck) {
    return {
      error: authCheck.error,
      reason: authCheck.reason,
    };
  }

  lifecycle.onPending?.();
  let sandbox;
  try {
    sandbox = await resolveOrCreateSandbox(userId, repoId, undefined, signal);
  } catch (error) {
    lifecycle.onFailure?.();
    throw error;
  }
  if (!sandbox) {
    lifecycle.onFailure?.();
    return {
      error: "Failed to start sandbox",
      reason: "sandbox_unavailable" as const,
    };
  }
  if ("error" in sandbox) {
    lifecycle.onFailure?.();
    return sandbox;
  }
  lifecycle.onResolution?.(sandbox);

  return {
    ok: true,
    sandboxId: sandbox.sandboxId,
    status: sandbox.status,
    sandboxResolution: sandbox.source,
    message: getSandboxStartMessage(sandbox),
  };
}

export function createStartSandbox(
  userId?: string,
  serverRepoId?: string,
  lifecycleInput?:
    | ((resolution: SandboxResolution) => void)
    | SandboxStartLifecycle
) {
  const lifecycle = normalizeLifecycle(lifecycleInput);
  if (serverRepoId) {
    return defineTool({
      description:
        "Start or reuse sandbox compute for the server-selected active repository when runtime or preview work needs a machine. An explicit request to provision, start, or prepare that compute authorizes calling this tool immediately, even if the request also names an unavailable tool with the same effect; do not ask for reconfirmation. The repository cannot be supplied by the model, and this does not create or imply a Git worktree.",
      inputSchema: startServerSelectedSandboxParams,
      execute: async (
        _input: z.infer<typeof startServerSelectedSandboxParams>,
        options?: ToolExecutionOptions
      ) => startSandbox(userId, serverRepoId, lifecycle, options?.abortSignal),
    });
  }

  return defineTool({
    description:
      "Start or reuse sandbox compute for an explicit runtime or preview request, or when execution needs a machine and no suitable sandbox is selected. An explicit request to provision, start, or prepare that compute authorizes calling this tool immediately, even if the request also names an unavailable tool with the same effect; do not ask for reconfirmation. This does not create or imply a Git worktree.",
    inputSchema: startSandboxParams,
    execute: async (
      { repoId }: z.infer<typeof startSandboxParams>,
      options?: ToolExecutionOptions
    ) => startSandbox(userId, repoId, lifecycle, options?.abortSignal),
  });
}
