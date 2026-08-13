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

export type SandboxResolutionFailure = { error: string };

export function getSandboxRequestHeaders(userId?: string) {
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
): Promise<SandboxResolution | null> {
  if (!response.ok) return null;
  const { sandbox } = await response.json();
  if (!sandbox?.id) return null;
  const running = sandbox.runtime_summary?.status === "running";
  return {
    sandboxId: sandbox.id as string,
    status: running ? "running" : "pending",
    source: running ? "reused_running" : "reused_pending",
  };
}

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

async function consumeSandboxCreationStream(
  response: Response
): Promise<SandboxResolution | null> {
  if (!response.body) return null;
  const reader = response.body.getReader();
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

/** Resolve selected or unique repo compute, starting it only when absent. */
export async function resolveOrCreateSandbox(
  userId?: string,
  repoId?: string,
  selectedSandboxId?: string
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
  if (!resolved.ok || !resolved.repoId) return null;

  const runningSandboxIds = await findRunningSandboxIds(
    userId,
    resolved.repoId
  );
  if (runningSandboxIds.length > 1) {
    return {
      error:
        "Multiple running sandboxes are available for this repository. Select one explicitly before continuing.",
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
  if ("error" in requestHeaders) return null;
  const response = await fetch(`${resolveAppBaseUrl()}/api/sandbox`, {
    method: "POST",
    headers: requestHeaders.headers,
    body: JSON.stringify({ repoId: resolved.repoId }),
  });

  return (response.headers.get("Content-Type") || "").includes(
    "application/json"
  )
    ? readReusedSandboxResponse(response)
    : consumeSandboxCreationStream(response);
}
