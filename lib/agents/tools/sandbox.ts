import { z } from "zod";
import { redactSecretsInText } from "@/lib/ai-telemetry";
import { defineTool, resolveAppBaseUrl } from "./shared";
import {
  getSandboxRequestHeaders,
  resolveOrCreateSandbox,
  type SandboxResolution,
  type SandboxResolutionFailure,
} from "./sandbox-resolution";
import {
  readSelectedSandboxId,
  updateSandboxBinding,
  type SandboxRuntimeBinding,
  type SandboxSelection,
} from "./sandbox-binding";
import { getBlockedAgentShellCommand } from "./shell-command-guard";
import {
  postSandboxExec,
  EXEC_STDOUT_LIMIT,
  EXEC_STDERR_LIMIT,
} from "./sandbox-http-execution";
import {
  describeUncommittedChanges,
  inspectUncommittedChanges,
} from "./sandbox-stop-guard";

export { getBlockedAgentShellCommand } from "./shell-command-guard";

export { resolveOrCreateSandbox } from "./sandbox-resolution";
export { createStartSandbox } from "./sandbox-start";

export type SandboxCommandExecution = {
  execute: typeof postSandboxExec;
  retryOnSandboxLoss?: boolean;
};

/** Shape an exec response, truncating streams so tool output stays bounded. */
function formatSandboxExecResult(
  data: { exitCode?: number; stdout?: string; stderr?: string },
  command: string,
  sandbox: SandboxResolution
) {
  return {
    // `data` is an unvalidated `res.json()`. A malformed response should reach
    // the model as "we don't know" rather than as 0, which it would read as a
    // clean exit, so surface the gap instead of asserting it away.
    exitCode: data.exitCode ?? null,
    stdout: redactSecretsInText(data.stdout?.slice(0, EXEC_STDOUT_LIMIT) ?? ""),
    stderr: redactSecretsInText(data.stderr?.slice(0, EXEC_STDERR_LIMIT) ?? ""),
    command,
    sandboxId: sandbox.sandboxId,
    sandboxResolution: sandbox.source,
  };
}

function formatSandboxExecError(
  data: { error?: unknown },
  command: string,
  sandbox: SandboxResolution | null
) {
  return {
    error:
      typeof data.error === "string"
        ? redactSecretsInText(data.error)
        : "Failed",
    command,
    ...(sandbox
      ? {
          sandboxId: sandbox.sandboxId,
          sandboxResolution: sandbox.source,
        }
      : {}),
  };
}

/**
 * A 404/410 means the sandbox died between resolution and exec. Re-resolve once
 * and replay the command.
 *
 * Returns `null` when the failure wasn't a sandbox loss. Otherwise reports the
 * re-resolved id even if the replay failed, so the caller can drop its cached
 * (now dead) id rather than reusing it on the next call.
 */
async function retryExecAfterSandboxLoss(
  res: Response,
  ctx: {
    userId?: string;
    repoId?: string;
    headers: HeadersInit;
    command: string;
    cwd?: string;
    execute: typeof postSandboxExec;
  }
): Promise<{
  sandbox: SandboxResolution | null;
  result:
    | ReturnType<typeof formatSandboxExecResult>
    | ReturnType<typeof formatSandboxExecError>
    | {
        error: string;
        reason: SandboxResolutionFailure["reason"];
        command: string;
      }
    | null;
} | null> {
  if (res.status !== 404 && res.status !== 410) return null;

  const resolution = await resolveOrCreateSandbox(ctx.userId, ctx.repoId);
  if (!resolution) {
    return { sandbox: null, result: null };
  }
  if ("error" in resolution) {
    return {
      sandbox: null,
      result: {
        error: resolution.error,
        reason: resolution.reason,
        command: ctx.command,
      },
    };
  }

  const retry = await ctx.execute(resolution.sandboxId, ctx.headers, {
    command: ctx.command,
    cwd: ctx.cwd,
  });

  const retryData = await retry.json().catch(() => ({}));
  return {
    sandbox: resolution,
    result: retry.ok
      ? formatSandboxExecResult(retryData, ctx.command, resolution)
      : formatSandboxExecError(retryData, ctx.command, resolution),
  };
}

const terminalParams = z.object({
  command: z.string().describe("Shell command to run"),
  cwd: z
    .string()
    .optional()
    .describe(
      "Optional working directory. Commands default to the sandbox launch directory, which may be a repository subdirectory. Relative paths resolve from that launch directory; absolute paths are used as given. Omit cwd to stay there. Run git rev-parse --show-toplevel to find the checkout root, then use that absolute path as cwd for repository-wide commands."
    ),
});

export function createTerminalExec(
  sandboxId?: string,
  userId?: string,
  repoId?: string,
  sandboxBinding?: SandboxRuntimeBinding,
  execution?: SandboxCommandExecution
) {
  let selectedSandboxId = sandboxBinding?.sandboxId ?? sandboxId;
  // Track the selected/resolved sandbox across calls within this tool instance.
  let cachedSandbox: SandboxResolution | null = selectedSandboxId
    ? { sandboxId: selectedSandboxId, status: "running", source: "selected" }
    : null;

  return defineTool({
    description:
      "Execute a shell command in the selected sandbox. If none is selected, fall back only to exactly one running sandbox for the active repository or start one when none exists. The result identifies the resolved sandbox. This does not create or imply a worktree.",
    inputSchema: terminalParams,
    execute: async ({ command, cwd }: z.infer<typeof terminalParams>) => {
      const blocked = getBlockedAgentShellCommand(command);
      if (blocked) return { ...blocked, command };
      if (sandboxBinding?.status === "pending") {
        return {
          error: "Sandbox startup is still in progress.",
          reason: "sandbox_pending" as const,
          command,
        };
      }
      const boundSandboxId = sandboxBinding?.sandboxId ?? undefined;
      if (sandboxBinding && boundSandboxId !== selectedSandboxId) {
        selectedSandboxId = boundSandboxId;
        cachedSandbox = selectedSandboxId
          ? {
              sandboxId: selectedSandboxId,
              status: "running",
              source: "selected",
            }
          : null;
      }
      const requestHeaders = getSandboxRequestHeaders(userId);
      if ("error" in requestHeaders) {
        return {
          error: requestHeaders.error,
          reason: requestHeaders.reason,
          command,
        };
      }

      // Resolve sandbox at execution time (not build time)
      if (!cachedSandbox) {
        const resolution = await resolveOrCreateSandbox(
          userId,
          repoId,
          selectedSandboxId
        );
        if (resolution && "error" in resolution) {
          return {
            error: resolution.error,
            reason: resolution.reason,
            command,
          };
        }
        cachedSandbox = resolution;
        selectedSandboxId = resolution?.sandboxId;
        updateSandboxBinding(sandboxBinding, resolution);
      }

      if (!cachedSandbox) {
        return {
          error: "No sandbox available. Select a repository first.",
          reason: "repo_not_selected" as const,
          command,
        };
      }

      const execute = execution?.execute ?? postSandboxExec;
      const res = await execute(
        cachedSandbox.sandboxId,
        requestHeaders.headers,
        {
          command,
          cwd,
        }
      );
      if (res.ok) {
        return formatSandboxExecResult(
          await res.json(),
          command,
          cachedSandbox
        );
      }

      const retried =
        execution?.retryOnSandboxLoss === false
          ? null
          : await retryExecAfterSandboxLoss(res, {
              userId,
              repoId,
              headers: requestHeaders.headers,
              command,
              cwd,
              execute,
            });
      if (retried) {
        cachedSandbox = retried.sandbox;
        selectedSandboxId = retried.sandbox?.sandboxId;
        updateSandboxBinding(sandboxBinding, retried.sandbox);
        if (retried.result) return retried.result;
      }

      const data = await res.json().catch(() => ({}));
      return formatSandboxExecError(data, command, cachedSandbox);
    },
  });
}

export const terminalExec = createTerminalExec();

export { createWriteFile } from "./sandbox-files";

const stopSandboxParams = z.object({
  sandboxId: z.string().describe("The sandbox ID to stop"),
  discardChanges: z
    .boolean()
    .optional()
    .describe(
      "Set true only after the operator has agreed to lose the sandbox's uncommitted changes. Without it, a sandbox with uncommitted work is not stopped."
    ),
});
type SandboxStopApiResponse = {
  reason?: string;
  files?: string[];
  error?: unknown;
  sandbox?: {
    id?: unknown;
    runtime_summary?: { status?: unknown };
    error_summary?: { current_error?: unknown };
  };
};
function readStopResponseString(value: unknown) {
  return typeof value === "string" ? value : null;
}
const SANDBOX_STOPPED_MESSAGE =
  "Sandbox compute stopped. Committed and pushed work is safe; uncommitted changes do not survive a restart. The sandbox record remains available for restart.";

function formatSandboxStopResult(
  data: SandboxStopApiResponse,
  requestedSandboxId: string
) {
  const stoppedSandbox = data.sandbox;
  const sandboxId =
    readStopResponseString(stoppedSandbox?.id) ?? requestedSandboxId;
  const status = readStopResponseString(
    stoppedSandbox?.runtime_summary?.status
  );
  if (status !== "stopped") {
    return {
      error:
        readStopResponseString(stoppedSandbox?.error_summary?.current_error) ??
        "Sandbox stop could not be confirmed. Its record remains available for reconciliation.",
      reason: "sandbox_unavailable" as const,
      sandboxId,
      status: status ?? "unknown",
    };
  }
  return {
    ok: true,
    sandboxId,
    status,
    message: SANDBOX_STOPPED_MESSAGE,
  };
}
export function createStopSandbox(
  userId?: string,
  serverSelectedSandbox?: SandboxSelection,
  execution?: SandboxCommandExecution
) {
  return defineTool({
    description:
      "Stop sandbox compute. Stopping discards the sandbox filesystem, so uncommitted edits are lost; commit and push them first. A sandbox with uncommitted changes is not stopped unless discardChanges is true after the operator agreed. Use this when the user asks to stop or shut down the preview. This does not delete the sandbox record, which remains available for restart.",
    inputSchema: stopSandboxParams,
    execute: async ({
      sandboxId,
      discardChanges,
    }: z.infer<typeof stopSandboxParams>) => {
      const serverSelectedSandboxId = readSelectedSandboxId(
        serverSelectedSandbox
      );
      if (serverSelectedSandbox !== undefined && !serverSelectedSandboxId) {
        return {
          error: "Select a sandbox first.",
          reason: "sandbox_not_selected" as const,
        };
      }
      if (serverSelectedSandboxId && sandboxId !== serverSelectedSandboxId) {
        return {
          error:
            "The requested sandbox is not the server-selected sandbox for this session.",
          reason: "sandbox_mismatch" as const,
        };
      }
      const baseUrl = resolveAppBaseUrl();
      const requestHeaders = getSandboxRequestHeaders(userId);
      if ("error" in requestHeaders) {
        return {
          error: requestHeaders.error,
          reason: requestHeaders.reason,
        };
      }
      if (!discardChanges) {
        const changes = await inspectUncommittedChanges(
          sandboxId,
          requestHeaders.headers,
          execution?.execute ?? postSandboxExec
        );
        if (changes.status === "dirty") {
          return {
            error: `The sandbox has ${describeUncommittedChanges(changes)}. Stopping discards them. Commit and push first, or ask the operator whether to discard them and call again with discardChanges: true.`,
            reason: "uncommitted_changes" as const,
            files: changes.files,
          };
        }
        if (changes.status === "unknown") {
          return {
            error: `Could not verify uncommitted changes (${changes.error}). The sandbox was not stopped. Retry the inspection, or ask the operator whether to discard any changes and call again with discardChanges: true.`,
            reason: "inspection_unavailable" as const,
          };
        }
      }
      const res = await fetch(`${baseUrl}/api/sandbox/${sandboxId}/stop`, {
        method: "POST",
        headers: requestHeaders.headers,
        body: JSON.stringify({ discardChanges: discardChanges === true }),
      });
      const data = (await res
        .json()
        .catch(() => ({}))) as SandboxStopApiResponse;
      if (!res.ok) {
        if (
          typeof serverSelectedSandbox === "object" &&
          (res.status === 404 || res.status === 410)
        ) {
          updateSandboxBinding(serverSelectedSandbox, null);
        }
        return {
          error: readStopResponseString(data.error) ?? "Failed to stop sandbox",
          ...(data.files ? { files: data.files } : {}),
          reason:
            data.reason === "uncommitted_changes" ||
            data.reason === "inspection_unavailable" ||
            data.reason === "sandbox_busy"
              ? data.reason
              : res.status === 404 || res.status === 410
                ? ("sandbox_not_found" as const)
                : ("sandbox_unavailable" as const),
        };
      }
      const result = formatSandboxStopResult(data, sandboxId);
      if ("ok" in result && typeof serverSelectedSandbox === "object") {
        updateSandboxBinding(serverSelectedSandbox, null);
      }
      return result;
    },
  });
}
