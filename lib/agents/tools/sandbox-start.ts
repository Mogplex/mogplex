import { z } from "zod";
import type { ToolExecutionOptions } from "ai";
import { defineTool } from "./shared";
import {
  updateSandboxBinding,
  type SandboxRuntimeBinding,
} from "./sandbox-binding";
import {
  getSandboxRequestHeaders,
  resolveOrCreateSandbox,
  type SandboxResolution,
} from "./sandbox-resolution";

const startServerSelectedSandboxParams = z.object({
  sandboxId: z
    .string()
    .uuid()
    .optional()
    .describe(
      "Select an existing running sandbox from the choices returned by this tool or bash. Omit to reuse the current selection or start a sandbox when none exists."
    ),
});
const startSandboxParams = startServerSelectedSandboxParams.extend({
  repoId: z
    .string()
    .describe(
      "The repo UUID (preferred) or GitHub full_name (e.g. 'owner/repo') to launch a sandbox for"
    ),
});

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
  if (sandbox.recoveredFromCleanup) {
    return "Previous sandbox cleanup finished automatically. Sandbox is ready to use.";
  }
  return sandbox.source === "reused_running"
    ? "Sandbox is already running and ready to use."
    : "Sandbox is ready to use.";
}

async function startSandbox(
  userId: string | undefined,
  repoId: string,
  lifecycle: SandboxStartLifecycle,
  signal?: AbortSignal,
  selection?: { sandboxId?: string; binding?: SandboxRuntimeBinding }
) {
  // Fail before repository lookups when the internal sandbox auth is absent.
  const authCheck = getSandboxRequestHeaders(userId);
  if ("error" in authCheck) {
    return {
      error: authCheck.error,
      reason: authCheck.reason,
    };
  }

  const binding = selection?.binding;
  if (binding?.status === "pending") {
    return {
      error: "Sandbox startup is still in progress.",
      reason: "sandbox_pending" as const,
    };
  }
  const selectedId = selection?.sandboxId ?? binding?.sandboxId ?? undefined;
  const previous = binding ? { ...binding } : undefined;
  const failed = () => {
    if (binding && previous) Object.assign(binding, previous);
    lifecycle.onFailure?.();
  };
  if (binding) binding.status = "pending";
  lifecycle.onPending?.();
  let sandbox;
  try {
    sandbox = await resolveOrCreateSandbox(userId, repoId, selectedId, signal);
  } catch (error) {
    failed();
    throw error;
  }
  if (!sandbox) {
    failed();
    return {
      error: "Failed to start sandbox",
      reason: "sandbox_unavailable" as const,
    };
  }
  if ("error" in sandbox) {
    failed();
    return sandbox;
  }
  updateSandboxBinding(binding, sandbox);
  lifecycle.onResolution?.(sandbox);

  return {
    ok: true,
    sandboxId: sandbox.sandboxId,
    status: sandbox.status,
    sandboxResolution: sandbox.source,
    ...(sandbox.recoveredFromCleanup
      ? {
          recoveredFromCleanup: true,
          cleanupWaitMs: sandbox.cleanupWaitMs ?? 0,
        }
      : {}),
    message: getSandboxStartMessage(sandbox),
  };
}

export function createStartSandbox(
  userId?: string,
  serverRepoId?: string,
  lifecycleInput?:
    | ((resolution: SandboxResolution) => void)
    | SandboxStartLifecycle,
  binding?: SandboxRuntimeBinding
) {
  const lifecycle = normalizeLifecycle(lifecycleInput);
  if (serverRepoId) {
    return defineTool({
      description:
        "Start or reuse sandbox compute for the server-selected active repository when runtime or preview work needs a machine. An explicit request to provision, start, or prepare that compute authorizes calling this tool immediately, even if the request also names an unavailable tool with the same effect; do not ask for reconfirmation. The repository cannot be supplied by the model, and this does not create or imply a Git worktree.",
      inputSchema: startServerSelectedSandboxParams,
      execute: async (
        { sandboxId }: z.infer<typeof startServerSelectedSandboxParams>,
        options?: ToolExecutionOptions<unknown>
      ) =>
        startSandbox(userId, serverRepoId, lifecycle, options?.abortSignal, {
          sandboxId,
          binding,
        }),
    });
  }

  return defineTool({
    description:
      "Start or reuse sandbox compute for an explicit runtime or preview request, or when execution needs a machine and no suitable sandbox is selected. An explicit request to provision, start, or prepare that compute authorizes calling this tool immediately, even if the request also names an unavailable tool with the same effect; do not ask for reconfirmation. This does not create or imply a Git worktree.",
    inputSchema: startSandboxParams,
    execute: async (
      { repoId, sandboxId }: z.infer<typeof startSandboxParams>,
      options?: ToolExecutionOptions<unknown>
    ) =>
      startSandbox(userId, repoId, lifecycle, options?.abortSignal, {
        sandboxId,
        binding,
      }),
  });
}
