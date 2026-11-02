import type { SandboxSetupIssue } from "@/lib/sandbox/events";
import type {
  SandboxResolution,
  SandboxResolutionFailure,
} from "./sandbox-resolution";
import { parseSetupIssue } from "./sandbox-setup-issue";

type SandboxCreationStreamEvent =
  | { kind: "ready"; resolution: SandboxResolution }
  | { kind: "setup_issue"; issue: SandboxSetupIssue }
  | { kind: "pending"; sandboxRecordId: string }
  | { kind: "cleanup_recovered"; elapsedMs: number }
  | { kind: "failed"; failure: SandboxResolutionFailure };

export type SandboxCreationStreamResult =
  | SandboxResolution
  | SandboxResolutionFailure
  | {
      streamEndedAfterSandboxCreated: true;
      cleanupWaitMs?: number;
      setupIssue?: SandboxSetupIssue;
    };

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
    phase?: string;
    elapsedMs?: number;
    issue?: unknown;
  };
  try {
    event = JSON.parse(line.slice(6));
  } catch {
    return null;
  }

  if (event.type === "setup_issue") {
    const issue = parseSetupIssue(event.issue);
    return issue ? { kind: "setup_issue", issue } : null;
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
      sandboxRecordId: event.recordId,
    };
  }
  if (
    event.type === "lifecycle" &&
    event.phase === "pending_cleanup" &&
    event.status === "recovered"
  ) {
    return {
      kind: "cleanup_recovered",
      elapsedMs:
        typeof event.elapsedMs === "number" && event.elapsedMs >= 0
          ? event.elapsedMs
          : 0,
    };
  }
  const lifecycleStatus =
    event.sandbox?.runtime_summary?.status ?? event.status;
  if (
    event.type === "error" ||
    event.type === "cancelled" ||
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

/** Read the launch SSE stream until the sandbox is ready, fails, or ends. */
export async function consumeSandboxCreationStream(
  response: Response,
  signal?: AbortSignal
): Promise<SandboxCreationStreamResult> {
  const failed = {
    error: "Failed to start sandbox",
    reason: "sandbox_unavailable" as const,
  };
  if (!response.ok || !response.body) return failed;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let pendingSandboxRecordId: string | null = null;
  let cleanupWaitMs: number | null = null;
  let setupIssue: SandboxSetupIssue | null = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split(/\r?\n/);
      buffer = done ? "" : (lines.pop() ?? "");

      for (const line of lines) {
        const settled = readSandboxCreationEvent(line);
        if (!settled) continue;
        if (settled.kind === "pending") {
          pendingSandboxRecordId = settled.sandboxRecordId;
          continue;
        }
        if (settled.kind === "cleanup_recovered") {
          cleanupWaitMs = settled.elapsedMs;
          continue;
        }
        if (settled.kind === "setup_issue") {
          setupIssue = settled.issue;
          continue;
        }
        await reader.cancel().catch(() => {});
        return settled.kind === "ready"
          ? {
              ...settled.resolution,
              ...(setupIssue ? { setupIssue } : {}),
              ...(cleanupWaitMs === null
                ? {}
                : {
                    recoveredFromCleanup: true,
                    cleanupWaitMs,
                  }),
            }
          : settled.failure;
      }
      if (done) break;
    }
  } catch (error) {
    if (!pendingSandboxRecordId || signal?.aborted) throw error;
    return {
      streamEndedAfterSandboxCreated: true,
      ...(cleanupWaitMs === null ? {} : { cleanupWaitMs }),
      ...(setupIssue ? { setupIssue } : {}),
    };
  }

  return pendingSandboxRecordId
    ? {
        streamEndedAfterSandboxCreated: true,
        ...(cleanupWaitMs === null ? {} : { cleanupWaitMs }),
        ...(setupIssue ? { setupIssue } : {}),
      }
    : failed;
}
