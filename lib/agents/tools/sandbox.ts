import { z } from "zod";
import { defineTool, resolveAppBaseUrl } from "./shared";
import {
  getSandboxRequestHeaders,
  resolveOrCreateSandbox,
  type SandboxResolution,
  type SandboxResolutionFailure,
} from "./sandbox-resolution";

export { resolveOrCreateSandbox } from "./sandbox-resolution";

const EXEC_STDOUT_LIMIT = 10_000;
const EXEC_STDERR_LIMIT = 5000;

function postSandboxExec(
  sandboxId: string,
  headers: HeadersInit,
  body: { command: string; cwd?: string }
): Promise<Response> {
  return fetch(`${resolveAppBaseUrl()}/api/sandbox/${sandboxId}/exec`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

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
    stdout: data.stdout?.slice(0, EXEC_STDOUT_LIMIT) ?? "",
    stderr: data.stderr?.slice(0, EXEC_STDERR_LIMIT) ?? "",
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
    error: typeof data.error === "string" ? data.error : "Failed",
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

  const retry = await postSandboxExec(resolution.sandboxId, ctx.headers, {
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
  cwd: z.string().optional().describe("Working directory"),
});

export function createTerminalExec(
  sandboxId?: string,
  userId?: string,
  repoId?: string
) {
  let selectedSandboxId = sandboxId;
  // Track the selected/resolved sandbox across calls within this tool instance.
  let cachedSandbox: SandboxResolution | null = sandboxId
    ? { sandboxId, status: "running", source: "selected" }
    : null;

  return defineTool({
    description:
      "Execute a shell command in the selected sandbox. If none is selected, fall back only to exactly one running sandbox for the active repository or start one when none exists. The result identifies the resolved sandbox. This does not create or imply a worktree.",
    inputSchema: terminalParams,
    execute: async ({ command, cwd }: z.infer<typeof terminalParams>) => {
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
      }

      if (!cachedSandbox) {
        return {
          error: "No sandbox available. Select a repository first.",
          reason: "repo_not_selected" as const,
          command,
        };
      }

      const res = await postSandboxExec(
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

      const retried = await retryExecAfterSandboxLoss(res, {
        userId,
        repoId,
        headers: requestHeaders.headers,
        command,
        cwd,
      });
      if (retried) {
        selectedSandboxId = undefined;
        cachedSandbox = retried.sandbox;
        if (retried.result) return retried.result;
      }

      const data = await res.json().catch(() => ({}));
      return formatSandboxExecError(data, command, cachedSandbox);
    },
  });
}

export const terminalExec = createTerminalExec();

const writeFileParams = z.object({
  path: z.string().describe("File path relative to sandbox root"),
  content: z.string().describe("File content to write"),
});

export function createWriteFile(userId?: string, sandboxId?: string) {
  return defineTool({
    description:
      "Write content to a file in the server-selected sandbox. The sandbox identity is fixed by the active session and cannot be supplied by the model.",
    inputSchema: writeFileParams,
    execute: async ({ path, content }: z.infer<typeof writeFileParams>) => {
      if (!sandboxId) {
        return {
          error: "Select a sandbox first.",
          reason: "sandbox_not_selected" as const,
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

      const res = await fetch(`${baseUrl}/api/sandbox/${sandboxId}/files`, {
        method: "PUT",
        headers: requestHeaders.headers,
        body: JSON.stringify({ path, content }),
      });

      if (!res.ok) {
        const data = await res.json();
        return {
          error: (data.error as string) || "Write failed",
          reason: "operation_failed" as const,
        };
      }

      return { ok: true, path, sandboxId };
    },
  });
}

const startSandboxParams = z.object({
  repoId: z
    .string()
    .describe(
      "The repo UUID (preferred) or GitHub full_name (e.g. 'owner/repo') to launch a sandbox for"
    ),
});

export function createStartSandbox(userId?: string) {
  return defineTool({
    description:
      "Start or reuse sandbox compute for an explicit runtime or preview request, or when execution needs a machine and no suitable sandbox is selected. This does not create or imply a Git worktree.",
    inputSchema: startSandboxParams,
    execute: async ({ repoId }: z.infer<typeof startSandboxParams>) => {
      const requestHeaders = getSandboxRequestHeaders(userId);
      if ("error" in requestHeaders) {
        return {
          error: requestHeaders.error,
          reason: requestHeaders.reason,
        };
      }

      const sandbox = await resolveOrCreateSandbox(userId, repoId);
      if (!sandbox) {
        return {
          error: "Failed to start sandbox",
          reason: "sandbox_unavailable" as const,
        };
      }
      if ("error" in sandbox) return sandbox;

      const message =
        sandbox.source === "reused_running"
          ? "Sandbox is already running and ready to use."
          : sandbox.source === "reused_pending"
            ? "Sandbox startup is already in progress. The preview pane will update automatically when it's ready."
            : "Sandbox is launching. The preview pane will update automatically when it's ready.";

      return {
        ok: true,
        sandboxId: sandbox.sandboxId,
        status: sandbox.status,
        sandboxResolution: sandbox.source,
        message,
      };
    },
  });
}

const stopSandboxParams = z.object({
  sandboxId: z.string().describe("The sandbox ID to stop"),
});
type SandboxStopApiResponse = {
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
    message:
      "Sandbox compute stopped. Its record and worktree bindings remain available for restart.",
  };
}
export function createStopSandbox(
  userId?: string,
  serverSelectedSandboxId?: string
) {
  return defineTool({
    description:
      "Stop sandbox compute while preserving its sandbox record and worktree bindings for restart. Use this when the user asks to stop or shut down the preview. This does not delete the sandbox record.",
    inputSchema: stopSandboxParams,
    execute: async ({ sandboxId }: z.infer<typeof stopSandboxParams>) => {
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
      const res = await fetch(`${baseUrl}/api/sandbox/${sandboxId}/stop`, {
        method: "POST",
        headers: requestHeaders.headers,
      });
      const data = (await res
        .json()
        .catch(() => ({}))) as SandboxStopApiResponse;
      if (!res.ok) {
        return {
          error: readStopResponseString(data.error) ?? "Failed to stop sandbox",
          reason:
            res.status === 404 || res.status === 410
              ? ("sandbox_not_found" as const)
              : ("sandbox_unavailable" as const),
        };
      }
      return formatSandboxStopResult(data, sandboxId);
    },
  });
}
