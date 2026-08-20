import { buildInternalApiHeaders } from "@/lib/internal-api-auth";
import { isRepoId } from "@/lib/repos";
import { resolveAppBaseUrl } from "./shared";

type SandboxResolutionStatus = "running" | "pending";
type SandboxResolutionSource =
  | "selected"
  | "reused_running"
  | "reused_pending"
  | "created";

export type SandboxResolution = {
  sandboxId: string;
  status: SandboxResolutionStatus;
  source: SandboxResolutionSource;
};

export type SandboxResolutionFailure = {
  error: string;
  reason:
    | "auth_unavailable"
    | "multiple_sandboxes"
    | "repo_lookup_failed"
    | "repo_mismatch"
    | "sandbox_unavailable";
};

export function getSandboxRequestHeaders(userId?: string) {
  try {
    return {
      headers: {
        ...buildInternalApiHeaders(userId),
        Accept: "text/event-stream, application/json",
      },
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
  if (repoId.includes("/")) {
    const { supabaseAdmin } = await import("@/lib/supabase/admin");
    const { data: lookup, error } = await supabaseAdmin
      .from("repos")
      .select("id")
      .eq("full_name", repoId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) return { ok: false, reason: "repo_lookup_failed" };
    return lookup?.id
      ? { ok: true, repoId: lookup.id }
      : { ok: false, reason: "repo_mismatch" };
  }
  return isRepoId(repoId)
    ? { ok: true, repoId }
    : { ok: false, reason: "repo_mismatch" };
}

async function findRunningSandboxIds(
  userId: string,
  repoId: string
): Promise<string[]> {
  const { supabaseAdmin } = await import("@/lib/supabase/admin");
  const { data } = await supabaseAdmin
    .from("sandboxes")
    .select("id")
    .eq("user_id", userId)
    .eq("repo_id", repoId)
    .eq("status", "running")
    .order("created_at", { ascending: false })
    .limit(2);

  return (data ?? []).flatMap((sandbox) =>
    typeof sandbox?.id === "string" ? [sandbox.id] : []
  );
}

async function readReusedSandboxResponse(
  response: Response
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
      error: "Sandbox startup did not provide a readiness stream.",
      reason: "sandbox_unavailable",
    };
  }
  return {
    sandboxId: sandbox.id as string,
    status: "running",
    source: "reused_running",
  };
}

type SandboxCreationStreamEvent =
  | { kind: "ready"; resolution: SandboxResolution }
  | { kind: "pending"; resolution: SandboxResolution }
  | { kind: "failed"; failure: SandboxResolutionFailure };

function readSandboxCreationEvent(
  line: string
): SandboxCreationStreamEvent | null {
  if (!line.startsWith("data: ")) return null;
  let event: {
    type?: string;
    status?: string;
    message?: string;
    sandbox?: { id: string; runtime_summary?: { status?: string } };
    recordId?: string;
  };
  try {
    event = JSON.parse(line.slice(6));
  } catch {
    return null;
  }

  if (event.type === "ready" && event.sandbox) {
    return {
      kind: "ready",
      resolution: {
        sandboxId: event.sandbox.id,
        status: "running",
        source: "created",
      },
    };
  }
  if (event.type === "sandbox_created" && event.recordId) {
    return {
      kind: "pending",
      resolution: {
        sandboxId: event.recordId,
        status: "pending",
        source: "created",
      },
    };
  }
  const lifecycleStatus =
    event.sandbox?.runtime_summary?.status ?? event.status;
  if (
    event.type === "error" ||
    lifecycleStatus === "stopped" ||
    lifecycleStatus === "error"
  ) {
    return {
      kind: "failed",
      failure: {
        error:
          event.message ||
          (lifecycleStatus === "stopped"
            ? "Sandbox stopped before it became ready."
            : "Sandbox failed before it became ready."),
        reason: "sandbox_unavailable",
      },
    };
  }
  return null;
}

async function consumeSandboxCreationStream(
  response: Response
): Promise<SandboxResolution | SandboxResolutionFailure> {
  const failed = {
    error: "Failed to start sandbox",
    reason: "sandbox_unavailable" as const,
  };
  if (!response.ok || !response.body) return failed;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let pending: SandboxResolution | null = null;

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split(/\r?\n/);
    buffer = done ? "" : (lines.pop() ?? "");

    for (const line of lines) {
      const settled = readSandboxCreationEvent(line);
      if (!settled) continue;
      if (settled.kind === "pending") {
        pending = settled.resolution;
        continue;
      }
      await reader.cancel().catch(() => {});
      return settled.kind === "ready" ? settled.resolution : settled.failure;
    }
    if (done) break;
  }

  return pending
    ? {
        error: "Sandbox readiness stream ended before it became ready.",
        reason: "sandbox_unavailable",
      }
    : failed;
}

/** Resolve selected or unique repo compute, starting it only when absent. */
export async function resolveOrCreateSandbox(
  userId?: string,
  repoId?: string,
  selectedSandboxId?: string,
  signal?: AbortSignal
): Promise<SandboxResolution | SandboxResolutionFailure | null> {
  if (selectedSandboxId) {
    return {
      sandboxId: selectedSandboxId,
      status: "running",
      source: "selected",
    };
  }
  if (!userId) return null;

  const resolved = await resolveRepoUuid(userId, repoId);
  if (!resolved.ok) {
    return { error: "Failed to start sandbox", reason: resolved.reason };
  }
  if (!resolved.repoId) return null;

  const runningSandboxIds = await findRunningSandboxIds(
    userId,
    resolved.repoId
  );
  if (runningSandboxIds.length > 1) {
    return {
      error:
        "Multiple running sandboxes are available for this repository. Select one explicitly before continuing.",
      reason: "multiple_sandboxes",
    };
  }
  const runningSandboxId = runningSandboxIds[0];
  if (runningSandboxId) {
    return {
      sandboxId: runningSandboxId,
      status: "running",
      source: "reused_running",
    };
  }

  const requestHeaders = getSandboxRequestHeaders(userId);
  if ("error" in requestHeaders) {
    return {
      error: requestHeaders.error ?? "Internal sandbox auth is not configured",
      reason: "auth_unavailable",
    };
  }
  const response = await fetch(`${resolveAppBaseUrl()}/api/sandbox`, {
    method: "POST",
    headers: requestHeaders.headers,
    body: JSON.stringify({ repoId: resolved.repoId }),
    signal,
  });

  return (response.headers.get("Content-Type") || "").includes(
    "application/json"
  )
    ? readReusedSandboxResponse(response)
    : consumeSandboxCreationStream(response);
}
