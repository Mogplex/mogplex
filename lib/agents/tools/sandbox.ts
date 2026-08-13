import { z } from "zod";
import { buildInternalApiHeaders } from "@/lib/internal-api-auth";
import { isRepoId } from "@/lib/repos";
import { defineTool, resolveAppBaseUrl } from "./shared";

type SandboxResolutionStatus = "running" | "pending";
type SandboxResolutionSource =
  | "hint"
  | "reused_running"
  | "reused_pending"
  | "created";

type SandboxResolution = {
  sandboxId: string;
  status: SandboxResolutionStatus;
  source: SandboxResolutionSource;
};

function getSandboxRequestHeaders(userId?: string) {
  try {
    return { headers: buildInternalApiHeaders(userId) };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Internal sandbox auth is not configured",
    };
  }
}

/**
 * LLMs frequently pass the GitHub full_name ("owner/repo") instead of the
 * repos.id UUID. Resolve it here so downstream queries and the /api/sandbox
 * call always see a UUID.
 *
 * Returns `{ ok: false }` when the reference names a repo the user can't reach,
 * which is distinct from `{ ok: true, repoId: undefined }` (no repo requested).
 */
async function resolveRepoUuid(
  userId: string,
  repoId: string | undefined
): Promise<{ ok: true; repoId: string | undefined } | { ok: false }> {
  if (!repoId) return { ok: true, repoId: undefined };

  if (repoId.includes("/")) {
    const { supabaseAdmin } = await import("@/lib/supabase/admin");
    const { data: lookup } = await supabaseAdmin
      .from("repos")
      .select("id")
      .eq("full_name", repoId)
      .eq("user_id", userId)
      .maybeSingle();
    return lookup?.id ? { ok: true, repoId: lookup.id } : { ok: false };
  }

  return isRepoId(repoId) ? { ok: true, repoId } : { ok: false };
}

/** Newest running sandbox for the user, optionally scoped to one repo. */
async function findRunningSandboxId(
  userId: string,
  repoId: string | undefined
): Promise<string | null> {
  const { supabaseAdmin } = await import("@/lib/supabase/admin");
  const query = supabaseAdmin
    .from("sandboxes")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "running")
    .order("created_at", { ascending: false })
    .limit(1);

  if (repoId) query.eq("repo_id", repoId);

  const { data } = await query.single();
  return data?.id ?? null;
}

/** A JSON response means the API handed back an already-existing sandbox. */
async function readReusedSandboxResponse(
  res: Response
): Promise<SandboxResolution | null> {
  if (!res.ok) return null;
  const { sandbox } = await res.json();
  if (!sandbox?.id) return null;

  const running = sandbox.runtime_summary?.status === "running";
  return {
    sandboxId: sandbox.id as string,
    status: running ? "running" : "pending",
    source: running ? "reused_running" : "reused_pending",
  };
}

/**
 * Classify one SSE line. `null` means "keep reading"; a settled result means
 * the caller should stop consuming the stream.
 */
function readSandboxCreationEvent(
  line: string
): { resolution: SandboxResolution | null } | null {
  if (!line.startsWith("data: ")) return null;

  let event: {
    type?: string;
    sandbox?: { id: string };
    recordId?: string;
  };
  try {
    event = JSON.parse(line.slice(6));
  } catch {
    return null;
  }

  if (event.type === "ready" && event.sandbox) {
    return {
      resolution: {
        sandboxId: event.sandbox.id,
        status: "running",
        source: "created",
      },
    };
  }

  // Settle once the record exists so the tool doesn't block on the full
  // bootstrap stream.
  if (event.type === "sandbox_created" && event.recordId) {
    return {
      resolution: {
        sandboxId: event.recordId,
        status: "pending",
        source: "created",
      },
    };
  }

  return event.type === "error" ? { resolution: null } : null;
}

/** SSE = new sandbox creation — consume until ready or error. */
async function consumeSandboxCreationStream(
  res: Response
): Promise<SandboxResolution | null> {
  if (!res.body) return null;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) return null;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const settled = readSandboxCreationEvent(line);
      if (!settled) continue;
      await reader.cancel().catch(() => {});
      return settled.resolution;
    }
  }
}

/**
 * Resolve the active sandbox ID for a user+repo at execution time.
 * If no sandbox is running and a repoId is provided, auto-creates one.
 */
export async function resolveOrCreateSandbox(
  userId?: string,
  repoId?: string,
  hintSandboxId?: string
): Promise<SandboxResolution | null> {
  if (hintSandboxId) {
    return {
      sandboxId: hintSandboxId,
      status: "running",
      source: "hint",
    };
  }

  if (!userId) return null;

  const resolved = await resolveRepoUuid(userId, repoId);
  if (!resolved.ok) return null;
  const resolvedRepoId = resolved.repoId;

  const runningSandboxId = await findRunningSandboxId(userId, resolvedRepoId);
  if (runningSandboxId) {
    return {
      sandboxId: runningSandboxId,
      status: "running",
      source: "reused_running",
    };
  }

  // No running sandbox — auto-start if we have a resolved repoId
  if (!resolvedRepoId) return null;

  const requestHeaders = getSandboxRequestHeaders(userId);
  if ("error" in requestHeaders) return null;

  const res = await fetch(`${resolveAppBaseUrl()}/api/sandbox`, {
    method: "POST",
    headers: requestHeaders.headers,
    body: JSON.stringify({ repoId: resolvedRepoId }),
  });

  return (res.headers.get("Content-Type") || "").includes("application/json")
    ? readReusedSandboxResponse(res)
    : consumeSandboxCreationStream(res);
}

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
  command: string
) {
  return {
    // `data` is an unvalidated `res.json()`. A malformed response should reach
    // the model as "we don't know" rather than as 0, which it would read as a
    // clean exit, so surface the gap instead of asserting it away.
    exitCode: data.exitCode ?? null,
    stdout: data.stdout?.slice(0, EXEC_STDOUT_LIMIT) ?? "",
    stderr: data.stderr?.slice(0, EXEC_STDERR_LIMIT) ?? "",
    command,
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
  sandboxId: string | null;
  result: ReturnType<typeof formatSandboxExecResult> | null;
} | null> {
  if (res.status !== 404 && res.status !== 410) return null;

  const sandboxId =
    (await resolveOrCreateSandbox(ctx.userId, ctx.repoId))?.sandboxId ?? null;
  if (!sandboxId) return { sandboxId: null, result: null };

  const retry = await postSandboxExec(sandboxId, ctx.headers, {
    command: ctx.command,
    cwd: ctx.cwd,
  });

  return {
    sandboxId,
    result: retry.ok
      ? formatSandboxExecResult(await retry.json(), ctx.command)
      : null,
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
  // Track the resolved sandbox ID across calls within this tool instance
  let cachedSandboxId = sandboxId || null;

  return defineTool({
    description:
      "Execute a bash command. Use this for running shell commands, installing packages, running scripts, git operations, and any system tasks. A sandbox will be started automatically if needed.",
    inputSchema: terminalParams,
    execute: async ({ command, cwd }: z.infer<typeof terminalParams>) => {
      // Resolve sandbox at execution time (not build time)
      if (!cachedSandboxId) {
        cachedSandboxId =
          (await resolveOrCreateSandbox(userId, repoId, sandboxId))
            ?.sandboxId ?? null;
      }

      if (!cachedSandboxId) {
        return {
          error: "No sandbox available. Select a repository first.",
          command,
        };
      }

      const requestHeaders = getSandboxRequestHeaders(userId);
      if ("error" in requestHeaders) {
        return { error: requestHeaders.error, command };
      }

      const res = await postSandboxExec(
        cachedSandboxId,
        requestHeaders.headers,
        {
          command,
          cwd,
        }
      );
      if (res.ok) {
        return formatSandboxExecResult(await res.json(), command);
      }

      const retried = await retryExecAfterSandboxLoss(res, {
        userId,
        repoId,
        headers: requestHeaders.headers,
        command,
        cwd,
      });
      if (retried) {
        cachedSandboxId = retried.sandboxId;
        if (retried.result) return retried.result;
      }

      const data = await res.json().catch(() => ({}));
      return { error: (data.error as string) || "Failed", command };
    },
  });
}

export const terminalExec = createTerminalExec();

const writeFileParams = z.object({
  path: z.string().describe("File path relative to sandbox root"),
  content: z.string().describe("File content to write"),
  sandboxId: z.string().describe("Sandbox record ID"),
});

export function createWriteFile(userId?: string) {
  return defineTool({
    description: "Write content to a file in the sandbox",
    inputSchema: writeFileParams,
    execute: async ({
      path,
      content,
      sandboxId,
    }: z.infer<typeof writeFileParams>) => {
      const baseUrl = resolveAppBaseUrl();

      const requestHeaders = getSandboxRequestHeaders(userId);
      if ("error" in requestHeaders) return { error: requestHeaders.error };

      const res = await fetch(`${baseUrl}/api/sandbox/${sandboxId}/files`, {
        method: "PUT",
        headers: requestHeaders.headers,
        body: JSON.stringify({ path, content }),
      });

      if (!res.ok) {
        const data = await res.json();
        return { error: (data.error as string) || "Write failed" };
      }

      return { ok: true, path };
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
      "Launch a sandbox microVM for the current repository. This clones the repo, installs dependencies, and starts the dev server. Use this when the user asks to start a preview, run code, or you need a live environment.",
    inputSchema: startSandboxParams,
    execute: async ({ repoId }: z.infer<typeof startSandboxParams>) => {
      const requestHeaders = getSandboxRequestHeaders(userId);
      if ("error" in requestHeaders) return { error: requestHeaders.error };

      const sandbox = await resolveOrCreateSandbox(userId, repoId);
      if (!sandbox) {
        return { error: "Failed to start sandbox" };
      }

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
export function createStopSandbox(userId?: string) {
  return defineTool({
    description:
      "Stop sandbox compute while preserving its sandbox record and worktree bindings for restart. Use this when the user asks to stop or shut down the preview. This does not delete the sandbox record.",
    inputSchema: stopSandboxParams,
    execute: async ({ sandboxId }: z.infer<typeof stopSandboxParams>) => {
      const baseUrl = resolveAppBaseUrl();
      const requestHeaders = getSandboxRequestHeaders(userId);
      if ("error" in requestHeaders) return { error: requestHeaders.error };
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
        };
      }
      return formatSandboxStopResult(data, sandboxId);
    },
  });
}
