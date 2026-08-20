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

async function startSandbox(
  userId: string | undefined,
  repoId: string,
  onResolution?: (resolution: SandboxResolution) => void,
  signal?: AbortSignal
) {
  const requestHeaders = getSandboxRequestHeaders(userId);
  if ("error" in requestHeaders) {
    return {
      error: requestHeaders.error,
      reason: requestHeaders.reason,
    };
  }

  const sandbox = await resolveOrCreateSandbox(
    userId,
    repoId,
    undefined,
    signal
  );
  if (!sandbox) {
    return {
      error: "Failed to start sandbox",
      reason: "sandbox_unavailable" as const,
    };
  }
  if ("error" in sandbox) return sandbox;
  onResolution?.(sandbox);

  return {
    ok: true,
    sandboxId: sandbox.sandboxId,
    status: sandbox.status,
    sandboxResolution: sandbox.source,
    message:
      sandbox.source === "reused_running"
        ? "Sandbox is already running and ready to use."
        : "Sandbox is ready to use.",
  };
}

export function createStartSandbox(
  userId?: string,
  serverRepoId?: string,
  onResolution?: (resolution: SandboxResolution) => void
) {
  if (serverRepoId) {
    return defineTool({
      description:
        "Start or reuse sandbox compute for the server-selected active repository when runtime or preview work needs a machine. An explicit request to provision, start, or prepare that compute authorizes calling this tool immediately, even if the request also names an unavailable tool with the same effect; do not ask for reconfirmation. The repository cannot be supplied by the model, and this does not create or imply a Git worktree.",
      inputSchema: startServerSelectedSandboxParams,
      execute: async (
        _input: z.infer<typeof startServerSelectedSandboxParams>,
        options?: ToolExecutionOptions
      ) =>
        startSandbox(userId, serverRepoId, onResolution, options?.abortSignal),
    });
  }

  return defineTool({
    description:
      "Start or reuse sandbox compute for an explicit runtime or preview request, or when execution needs a machine and no suitable sandbox is selected. An explicit request to provision, start, or prepare that compute authorizes calling this tool immediately, even if the request also names an unavailable tool with the same effect; do not ask for reconfirmation. This does not create or imply a Git worktree.",
    inputSchema: startSandboxParams,
    execute: async (
      { repoId }: z.infer<typeof startSandboxParams>,
      options?: ToolExecutionOptions
    ) => startSandbox(userId, repoId, onResolution, options?.abortSignal),
  });
}
