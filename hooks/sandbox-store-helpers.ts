import {
  mergeSandboxRecord,
  toSandboxRecord,
} from "@/lib/sandbox/client-record";
import { getActiveTeamRequestHeaders } from "@/components/active-scope-provider";
import { parseSandboxErrorCode } from "@/lib/sandbox/error-state";
import { toast } from "@/hooks/use-toast";
import type { SandboxError } from "@/lib/sandbox/error-state";
import type { SandboxEvent } from "@/lib/sandbox/events";
import type { SandboxLifecycleStatus, SandboxRecord } from "@/lib/types";
import type {
  SandboxGetState,
  SandboxSetState,
  SandboxStateIndexes,
  SandboxStore,
} from "./sandbox-store-types";
import {
  buildSandboxStateKey,
  parseSandboxStateKey,
} from "./sandbox-state-keys";

export const SANDBOX_STATUS_PRIORITY: Record<SandboxLifecycleStatus, number> = {
  running: 0,
  installing: 1,
  creating: 2,
  pausing: 3,
  paused: 4,
  error: 5,
  stopped: 6,
};

export function compareSandboxRecords(a: SandboxRecord, b: SandboxRecord) {
  const aStatus = a.runtime_summary.status as SandboxLifecycleStatus;
  const bStatus = b.runtime_summary.status as SandboxLifecycleStatus;
  const statusOrder =
    SANDBOX_STATUS_PRIORITY[aStatus] - SANDBOX_STATUS_PRIORITY[bStatus];
  if (statusOrder !== 0) return statusOrder;

  const createdAtOrder =
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  if (createdAtOrder !== 0) return createdAtOrder;

  return b.id.localeCompare(a.id);
}

export function rebuildSandboxIndexes(
  sandboxesById: Record<string, SandboxRecord>
): SandboxStateIndexes {
  const sandboxIdsByRepoId: Record<string, string[]> = {};

  for (const sandbox of Object.values(sandboxesById)) {
    const next = sandboxIdsByRepoId[sandbox.repo_id] ?? [];
    next.push(sandbox.id);
    sandboxIdsByRepoId[sandbox.repo_id] = next;
  }

  const sandboxes: Record<string, SandboxRecord> = {};
  for (const [repoId, ids] of Object.entries(sandboxIdsByRepoId)) {
    ids.sort((a, b) =>
      compareSandboxRecords(sandboxesById[a], sandboxesById[b])
    );
    if (ids[0]) {
      sandboxes[repoId] = sandboxesById[ids[0]];
    }
  }

  return {
    sandboxes,
    sandboxesById,
    sandboxIdsByRepoId,
  };
}

export function withSandboxRecord(
  indexes: SandboxStateIndexes,
  record: SandboxRecord
): SandboxStateIndexes {
  return rebuildSandboxIndexes({
    ...indexes.sandboxesById,
    [record.id]: toSandboxRecord(record),
  });
}

export function withoutSandboxRecord(
  indexes: SandboxStateIndexes,
  recordId: string
): SandboxStateIndexes {
  const { [recordId]: _removed, ...remaining } = indexes.sandboxesById;
  return rebuildSandboxIndexes(remaining);
}

export function parseSseLines(buffer: string): {
  events: SandboxEvent[];
  remainder: string;
} {
  const events: SandboxEvent[] = [];
  const lines = buffer.split("\n");
  const remainder = lines.pop() || "";

  for (const line of lines) {
    if (!line.startsWith("data: ")) continue;
    try {
      events.push(JSON.parse(line.slice(6)) as SandboxEvent);
    } catch {
      // Ignore malformed chunks and continue processing the stream.
    }
  }

  return { events, remainder };
}

export function incrementCreatingState(state: SandboxStore, stateKey: string) {
  const nextCount = (state.creatingCounts[stateKey] ?? 0) + 1;
  return {
    creatingCounts: {
      ...state.creatingCounts,
      [stateKey]: nextCount,
    },
    creating: new Set([...state.creating, stateKey]),
  };
}

export function decrementCreatingState(state: SandboxStore, stateKey: string) {
  const nextCounts = { ...state.creatingCounts };
  const nextCount = (nextCounts[stateKey] ?? 0) - 1;

  if (nextCount > 0) {
    nextCounts[stateKey] = nextCount;
  } else {
    delete nextCounts[stateKey];
  }

  const nextCreating = new Set(state.creating);
  if (!nextCounts[stateKey]) {
    nextCreating.delete(stateKey);
  }

  return {
    creatingCounts: nextCounts,
    creating: nextCreating,
  };
}

export function hasCreatingLaunchForRepo(
  creating: ReadonlySet<string>,
  repoId: string
) {
  const repoPrefix = `${repoId}:`;
  for (const stateKey of creating) {
    if (stateKey.startsWith(repoPrefix)) return true;
  }
  return false;
}

export function applyLaunchSandboxRecord(
  sandbox: SandboxRecord,
  set: SandboxSetState
) {
  set((state) => {
    const nextIndexes = withSandboxRecord(state, sandbox);
    return {
      ...nextIndexes,
      activeSandboxId: sandbox.id,
    };
  });
}

export function buildSandboxLaunchError(
  message: string,
  launchAttemptId?: string
): SandboxError {
  return {
    message,
    code: parseSandboxErrorCode(message),
    ...(launchAttemptId ? { launchAttemptId } : {}),
  };
}

export async function consumeSandboxLaunchResponse(
  repoId: string,
  launchStateKey: string,
  res: Response,
  set: SandboxSetState,
  get: SandboxGetState,
  launchAttemptId?: string,
  resumeLaunch?: () => Promise<Response>
) {
  const contentType = res.headers.get("Content-Type") || "";
  let launchScope = parseSandboxStateKey(repoId, launchStateKey);
  const updateLaunchScope = (sandbox: SandboxRecord) => {
    launchScope = {
      workingBranch: sandbox.working_branch,
      rootDirectory: sandbox.root_directory,
    };
  };

  if (contentType.includes("application/json")) {
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Failed to create sandbox");
    }
    const sandbox = toSandboxRecord(data.sandbox);
    get().setSandboxRecord(sandbox);
    return sandbox;
  }

  if (!res.body) throw new Error("No response stream");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalSandbox: SandboxRecord | null = null;
  let shouldResume = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const { events, remainder } = parseSseLines(buffer);
    buffer = remainder;

    for (const event of events) {
      switch (event.type) {
        case "status": {
          const sandbox = toSandboxRecord(event.sandbox);
          updateLaunchScope(sandbox);
          applyLaunchSandboxRecord(sandbox, set);
          break;
        }
        case "sandbox_created": {
          const sandbox = toSandboxRecord(event.sandbox);
          updateLaunchScope(sandbox);
          applyLaunchSandboxRecord(sandbox, set);
          break;
        }
        case "snapshot_restore":
          get().appendLog(
            repoId,
            `Restoring from snapshot ${event.snapshotId}...\n`,
            { ...launchScope }
          );
          break;
        case "log":
          get().appendLog(repoId, event.data, { ...launchScope });
          break;
        case "lifecycle":
          get().appendLog(repoId, `${event.message}\n`, { ...launchScope });
          break;
        case "preview_url": {
          const sandbox = toSandboxRecord(event.sandbox);
          updateLaunchScope(sandbox);
          applyLaunchSandboxRecord(sandbox, set);
          break;
        }
        case "ready":
          finalSandbox = toSandboxRecord(event.sandbox);
          updateLaunchScope(finalSandbox);
          get().setSandboxRecord(finalSandbox);
          break;
        case "resume_required":
          shouldResume = true;
          break;
        case "error": {
          toast({
            title: "Sandbox error",
            description: event.message,
            variant: "destructive",
          });
          set((state) => ({
            errors: {
              ...state.errors,
              [launchStateKey]: buildSandboxLaunchError(
                event.message,
                launchAttemptId
              ),
            },
          }));
          return null;
        }
      }
    }
  }

  if (finalSandbox) return finalSandbox;

  if (shouldResume) {
    if (!resumeLaunch)
      throw new Error(
        "Sandbox cleanup finished, but the launch could not resume automatically. Retry the launch."
      );
    return consumeSandboxLaunchResponse(
      repoId,
      launchStateKey,
      await resumeLaunch(),
      set,
      get,
      launchAttemptId
    );
  }

  const refreshed = await get().refresh();
  if (!refreshed) {
    throw new Error(
      "Sandbox launch stream ended before a ready event and inventory refresh failed"
    );
  }
  const reconciledSandbox = get().getSandboxForRepo(repoId, {
    ...launchScope,
  });
  if (!reconciledSandbox) {
    throw new Error(
      "Sandbox launch stream ended before a ready event and the refreshed inventory did not contain the sandbox"
    );
  }
  return reconciledSandbox;
}

export async function executeExtend(
  recordId: string,
  minutes: number,
  set: SandboxSetState
) {
  const res = await fetch(`/api/sandbox/${recordId}/extend`, {
    method: "POST",
    headers: getActiveTeamRequestHeaders({
      "Content-Type": "application/json",
    }),
    body: JSON.stringify({ minutes }),
  });
  if (!res.ok) {
    const data = await res.json();
    toast({
      title: "Extend failed",
      description: data.error || "Failed to extend sandbox",
      variant: "destructive",
    });
    return;
  }
  toast({
    title: "Sandbox extended",
    description: `Extended by ${minutes} minutes`,
  });
  set((state) => {
    const existing = state.sandboxesById[recordId];
    if (!existing) return state;
    return withSandboxRecord(state, {
      ...existing,
      last_active_at: new Date().toISOString(),
    });
  });
}

export async function executePause(
  recordId: string,
  set: SandboxSetState,
  get: SandboxGetState
) {
  const res = await fetch(`/api/sandbox/${recordId}/pause`, {
    method: "POST",
    headers: getActiveTeamRequestHeaders(),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    toast({
      title: "Pause failed",
      description: data.error || "Failed to pause sandbox",
      variant: "destructive",
    });
    return;
  }
  const data = await res.json().catch(() => ({}));
  if (data.sandbox?.id) {
    get().setSandboxRecord(toSandboxRecord(data.sandbox));
    toast({ title: "Sandbox paused" });
    return;
  }
  set((state) => {
    const existing = state.sandboxesById[recordId];
    if (!existing) return state;
    return withSandboxRecord(
      state,
      mergeSandboxRecord(
        existing,
        { id: recordId, status: "paused", health_status: "paused" },
        existing.repo_id
      )
    );
  });
  toast({ title: "Sandbox paused" });
}

export async function executeStop(
  recordId: string,
  set: SandboxSetState,
  get: SandboxGetState
) {
  const res = await fetch(`/api/sandbox/${recordId}/stop`, {
    method: "POST",
    headers: getActiveTeamRequestHeaders(),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Failed to stop sandbox");
  }
  const data = await res.json().catch(() => ({}));
  if (data.sandbox?.id) {
    get().setSandboxRecord(toSandboxRecord(data.sandbox));
    return;
  }
  set((state) => {
    const existing = state.sandboxesById[recordId];
    if (!existing) return state;
    const nextIndexes = withSandboxRecord(
      state,
      mergeSandboxRecord(
        existing,
        {
          id: recordId,
          status: "stopped",
          health_status: "stopped",
          stop_reason: "manual",
        },
        existing.repo_id
      )
    );
    return {
      ...nextIndexes,
      activeSandboxId: state.activeSandboxId,
    };
  });
}
export async function executeDeleteRecord(
  recordId: string,
  set: SandboxSetState
) {
  const res = await fetch(`/api/sandbox/${recordId}`, {
    method: "DELETE",
    headers: getActiveTeamRequestHeaders(),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Failed to delete sandbox");
  }
  set((state) => {
    const existing = state.sandboxesById[recordId];
    if (!existing) return state;
    const nextIndexes = withoutSandboxRecord(state, recordId);
    const stateKey = buildSandboxStateKey(
      existing.repo_id,
      existing.working_branch,
      existing.root_directory
    );
    const { [stateKey]: _error, ...restErrors } = state.errors;
    const { [stateKey]: _log, ...restLogs } = state.logs;
    return {
      ...nextIndexes,
      activeSandboxId:
        state.activeSandboxId === recordId ? null : state.activeSandboxId,
      errors: restErrors,
      logs: restLogs,
    };
  });
}
export async function executeRefresh(set: SandboxSetState) {
  const sandboxesById: Record<string, SandboxRecord> = {};
  try {
    const res = await fetch("/api/sandbox");
    if (!res.ok) return false;
    const payload: unknown = await res.json();
    if (
      !payload ||
      typeof payload !== "object" ||
      !("sandboxes" in payload) ||
      !Array.isArray(payload.sandboxes)
    ) {
      return false;
    }
    for (const sandbox of payload.sandboxes) {
      if (!sandbox || typeof sandbox !== "object") return false;
      const normalized = toSandboxRecord(sandbox as SandboxRecord);
      sandboxesById[normalized.id] = normalized;
    }
  } catch {
    // Refresh runs in background sync and realtime callbacks. Preserve the last
    // known inventory for network and response-decoding failures instead of
    // leaking an unhandled rejection from a fire-and-forget caller.
    return false;
  }
  set((state) => {
    const nextIndexes = rebuildSandboxIndexes(sandboxesById);
    const activeSandboxId = nextIndexes.sandboxesById[
      state.activeSandboxId ?? ""
    ]
      ? state.activeSandboxId
      : null;
    return { ...nextIndexes, activeSandboxId };
  });
  return true;
}
