import type { SandboxSetupIssue } from "@/lib/sandbox/events";
import {
  consumeSandboxCreationStream,
  type SandboxCreationStreamResult,
} from "./sandbox-creation-stream";
import { buildInternalApiHeaders } from "@/lib/internal-api-auth";
import { isRepoId } from "@/lib/repos";
import { SANDBOX_READINESS_WAIT_HEADER } from "@/lib/sandbox/readiness-contract";
import { resolveAppBaseUrl } from "./shared";

type SandboxResolutionStatus = "running";
type SandboxResolutionSource = "selected" | "reused_running" | "created";

export type SandboxResolution = {
  sandboxId: string;
  status: SandboxResolutionStatus;
  source: SandboxResolutionSource;
  recoveredFromCleanup?: boolean;
  cleanupWaitMs?: number;
  /** Project setup failed during this boot; the sandbox is still running. */
  setupIssue?: SandboxSetupIssue;
  /** A reused running sandbox whose last boot did not finish setup. */
  lastBootError?: string;
};

export type SandboxResolutionFailure = {
  error: string;
  sandboxes?: RunningSandboxChoice[];
  reason:
    | "auth_unavailable"
    | "multiple_sandboxes"
    | "repo_lookup_failed"
    | "repo_mismatch"
    | "sandbox_unavailable";
};

type RunningSandboxChoice = {
  id: string;
  working_branch: string | null;
  root_directory: string | null;
  last_active_at: string | null;
  last_boot_error?: string | null;
};

export function getSandboxRequestHeaders(userId?: string) {
  try {
    return {
      headers: buildInternalApiHeaders(userId),
    };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Internal sandbox auth is not configured",
      reason: "auth_unavailable" as const,
    };
  }
}

async function resolveRepoUuid(
  userId: string,
  repoId: string | undefined
): Promise<
  | { ok: true; repoId: string | undefined }
  | { ok: false; reason: "repo_lookup_failed" | "repo_mismatch" }
> {
  if (!repoId) return { ok: true, repoId: undefined };
  const lookupColumn = repoId.includes("/") ? "full_name" : "id";
  if (lookupColumn === "id" && !isRepoId(repoId)) {
    return { ok: false, reason: "repo_mismatch" };
  }

  const { supabaseAdmin } = await import("@/lib/supabase/admin");
  const { data: lookup, error } = await supabaseAdmin
    .from("repos")
    .select("id")
    .eq(lookupColumn, repoId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return { ok: false, reason: "repo_lookup_failed" };
  return lookup?.id
    ? { ok: true, repoId: lookup.id }
    : { ok: false, reason: "repo_mismatch" };
}

function lastBootErrorField(value: unknown) {
  return typeof value === "string" && value ? { lastBootError: value } : {};
}

function repoResolutionFailure(
  reason: "repo_lookup_failed" | "repo_mismatch"
): SandboxResolutionFailure {
  return {
    error:
      reason === "repo_mismatch"
        ? "Repository not found for this user."
        : "Repository lookup failed. Try again.",
    reason,
  };
}

async function findRunningSandboxes(
  userId: string,
  repoId: string
): Promise<RunningSandboxChoice[] | SandboxResolutionFailure> {
  const { supabaseAdmin } = await import("@/lib/supabase/admin");
  const { data, error } = await supabaseAdmin
    .from("sandboxes")
    .select(
      "id, working_branch, root_directory, last_active_at, last_boot_error"
    )
    .eq("user_id", userId)
    .eq("repo_id", repoId)
    .eq("status", "running")
    .order("created_at", { ascending: false });

  if (error)
    return {
      error: "Could not load running sandboxes. Try again.",
      reason: "sandbox_unavailable",
    };
  return (data ?? []) as RunningSandboxChoice[];
}

async function loadOwnedSandbox(
  userId: string,
  sandboxId: string,
  repoId?: string
) {
  const { supabaseAdmin } = await import("@/lib/supabase/admin");
  let query = supabaseAdmin
    .from("sandboxes")
    .select("id,status,persistent,last_boot_error")
    .eq("id", sandboxId)
    .eq("user_id", userId);
  if (repoId) query = query.eq("repo_id", repoId);
  const { data, error } = await query.maybeSingle();
  return !error && data?.id === sandboxId ? data : null;
}

async function readReusedSandboxResponse(
  response: Response,
  runningSource: SandboxResolutionSource
): Promise<SandboxResolution | SandboxResolutionFailure> {
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as {
      error?: unknown;
    };
    return {
      error:
        typeof data.error === "string" ? data.error : "Failed to start sandbox",
      reason: "sandbox_unavailable",
    };
  }
  const { sandbox } = await response.json();
  if (!sandbox?.id) {
    return { error: "Failed to start sandbox", reason: "sandbox_unavailable" };
  }
  const status = sandbox.runtime_summary?.status ?? sandbox.status;
  if (
    status !== "running" &&
    status !== "creating" &&
    status !== "installing"
  ) {
    const stateMessage =
      status === "stopped"
        ? "Sandbox stopped before it became ready."
        : status === "error"
          ? "Sandbox failed before it became ready."
          : status === "paused"
            ? "Sandbox is paused and not ready for execution."
            : "Sandbox is not ready for execution.";
    return { error: stateMessage, reason: "sandbox_unavailable" };
  }
  if (status !== "running") {
    return {
      error:
        "Sandbox is still starting, but no readiness stream was available.",
      reason: "sandbox_unavailable",
    };
  }
  return {
    sandboxId: sandbox.id as string,
    status: "running",
    source: runningSource,
  };
}

async function requestSandboxStart(
  userId: string,
  repoId: string,
  headers: Record<string, string>,
  signal?: AbortSignal,
  runningSource: Extract<
    SandboxResolutionSource,
    "reused_running" | "created"
  > = "reused_running"
): Promise<SandboxCreationStreamResult> {
  const response = await fetch(`${resolveAppBaseUrl()}/api/sandbox`, {
    method: "POST",
    headers: {
      ...headers,
      Accept: "text/event-stream, application/json",
      [SANDBOX_READINESS_WAIT_HEADER]: "1",
    },
    body: JSON.stringify({ repoId }),
    signal,
  });

  return (response.headers.get("Content-Type") || "").includes(
    "application/json"
  )
    ? readReusedSandboxResponse(response, runningSource)
    : consumeSandboxCreationStream(response, signal);
}

/** Resume only the selected persisted workspace; never replace it on failure. */
async function resumeSelectedSandbox(
  userId: string,
  sandboxId: string,
  signal?: AbortSignal
): Promise<SandboxResolution | SandboxResolutionFailure> {
  const auth = getSandboxRequestHeaders(userId);
  if ("error" in auth)
    return {
      error: auth.error ?? "Internal sandbox auth is not configured",
      reason: "auth_unavailable",
    };
  const response = await fetch(
    `${resolveAppBaseUrl()}/api/sandbox/${encodeURIComponent(sandboxId)}/resume`,
    { method: "POST", headers: auth.headers, signal }
  );
  const result =
    !response.ok ||
    (response.headers.get("Content-Type") ?? "").includes("application/json")
      ? await readReusedSandboxResponse(response, "selected")
      : await consumeSandboxCreationStream(response, signal);
  if ("error" in result) return result;
  if (!("sandboxId" in result) || result.sandboxId !== sandboxId)
    return {
      error:
        "The selected workspace has not finished resuming. Its saved files have not been replaced.",
      reason: "sandbox_unavailable",
    };
  return { ...result, source: "selected" };
}

/** Resolve selected or unique repo compute, starting it only when absent. */
export async function resolveOrCreateSandbox(
  userId?: string,
  repoId?: string,
  selectedSandboxId?: string,
  signal?: AbortSignal
): Promise<SandboxResolution | SandboxResolutionFailure | null> {
  if (!userId)
    return selectedSandboxId
      ? {
          error: "The selected sandbox is unavailable.",
          reason: "sandbox_unavailable",
        }
      : null;
  const resolved = await resolveRepoUuid(userId, repoId);
  if (!resolved.ok) return repoResolutionFailure(resolved.reason);
  if (selectedSandboxId) {
    const selected = await loadOwnedSandbox(
      userId,
      selectedSandboxId,
      resolved.repoId
    );
    if (!selected) {
      return {
        error: "The selected sandbox is unavailable.",
        reason: "sandbox_unavailable",
      };
    }
    if (selected.status === "stopped" || selected.status === "paused")
      return resumeSelectedSandbox(userId, selectedSandboxId, signal);
    if (selected.status !== "running")
      return {
        error:
          "The selected sandbox is not ready. Its saved workspace has not been replaced.",
        reason: "sandbox_unavailable",
      };
    return {
      sandboxId: selectedSandboxId,
      status: "running",
      source: "selected",
      ...lastBootErrorField(selected.last_boot_error),
    };
  }
  if (!resolved.repoId) return null;

  const runningSandboxes = await findRunningSandboxes(userId, resolved.repoId);
  if ("error" in runningSandboxes) return runningSandboxes;
  if (runningSandboxes.length > 1) {
    return {
      error:
        "Multiple running sandboxes are available for this repository. Call start_sandbox with one of the listed sandboxId values. Use the branch and directory to identify the intended workspace; ask the user if it is unclear. Keep the other sandboxes running.",
      reason: "multiple_sandboxes",
      sandboxes: runningSandboxes,
    };
  }
  const running = runningSandboxes[0];
  if (running) {
    return {
      sandboxId: running.id,
      status: "running",
      source: "reused_running",
      ...lastBootErrorField(running.last_boot_error),
    };
  }

  const requestHeaders = getSandboxRequestHeaders(userId);
  if ("error" in requestHeaders) {
    return {
      error: requestHeaders.error ?? "Internal sandbox auth is not configured",
      reason: "auth_unavailable",
    };
  }
  const first = await requestSandboxStart(
    userId,
    resolved.repoId,
    requestHeaders.headers,
    signal
  );
  if (!("streamEndedAfterSandboxCreated" in first)) return first;

  // The sandbox_created event is emitted only after persistence. Reattach once
  // through the same route so it adopts that pending record and resumes the
  // Neon-notified wait without provisioning duplicate compute or polling.
  const reattached = await requestSandboxStart(
    userId,
    resolved.repoId,
    requestHeaders.headers,
    signal,
    "created"
  );
  if ("streamEndedAfterSandboxCreated" in reattached) {
    return {
      error: "Sandbox readiness stream ended before it became ready.",
      reason: "sandbox_unavailable",
    };
  }
  if ("error" in reattached) return reattached;
  // A setup issue streamed before the first stream ended still applies.
  const withSetup =
    first.setupIssue && !reattached.setupIssue
      ? { ...reattached, setupIssue: first.setupIssue }
      : reattached;
  if (first.cleanupWaitMs === undefined) return withSetup;
  return {
    ...withSetup,
    recoveredFromCleanup: true,
    cleanupWaitMs: first.cleanupWaitMs,
  };
}
