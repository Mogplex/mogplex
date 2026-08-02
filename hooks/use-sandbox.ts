"use client";
import { useEffect } from "react";
import { create } from "zustand";
import {
  mergeSandboxRecord,
  toSandboxRecord,
} from "@/lib/sandbox/client-record";
import {
  createSandboxLaunchAttemptId,
  parseSandboxErrorCode,
} from "@/lib/sandbox/error-state";
import { toast } from "@/hooks/use-toast";
import { createClient as createSupabaseClient } from "@/lib/supabase/client";
import { useUser } from "@/hooks/use-user";
import { getActiveTeamRequestHeaders } from "@/components/active-scope-provider";
import type { SandboxRecordPatch } from "@/lib/sandbox/client-record";
import type { SandboxError } from "@/lib/sandbox/error-state";
import type { SandboxLaunchRequestInput } from "@/lib/sandbox/launch-config";
import type { SandboxEvent } from "@/lib/sandbox/events";
import type { SandboxLifecycleStatus, SandboxRecord } from "@/lib/types";

const launchingKeys = new Set<string>();

type SandboxSetState = (
  partial:
    | SandboxStore
    | Partial<SandboxStore>
    | ((state: SandboxStore) => SandboxStore | Partial<SandboxStore>)
) => void;

type SandboxGetState = () => SandboxStore;

type SandboxStateIndexes = Pick<
  SandboxStore,
  "sandboxes" | "sandboxesById" | "sandboxIdsByRepoId"
>;
type SandboxStateScope = {
  sandboxId?: string | null;
  workingBranch?: string | null;
  /**
   * Omitted/undefined means the caller did not scope by root directory.
   * Branch-only read helpers fan out across matching roots; null explicitly
   * means repo root.
   */
  rootDirectory?: string | null;
};
type SandboxLaunchAttemptOptions = {
  launchAttemptId?: string;
};

type SandboxStore = {
  sandboxes: Record<string, SandboxRecord>;
  sandboxesById: Record<string, SandboxRecord>;
  sandboxIdsByRepoId: Record<string, string[]>;
  activeSandboxId: string | null;
  creating: Set<string>;
  creatingCounts: Record<string, number>;
  errors: Record<string, SandboxError>;
  logs: Record<string, string>;

  setActiveSandbox: (id: string | null) => void;
  setSandboxRecord: (record: SandboxRecord) => void;
  applySandboxPatch: (record: SandboxRecordPatch) => void;
  launch: (
    repoId: string,
    launchRequest?: SandboxLaunchRequestInput,
    options?: SandboxLaunchAttemptOptions
  ) => Promise<SandboxRecord | null>;
  restart: (
    repoId: string,
    options?: { sandboxId?: string | null }
  ) => Promise<SandboxRecord | null>;
  retryLaunch: (
    repoId: string,
    launchRequest?: SandboxLaunchRequestInput
  ) => Promise<SandboxRecord | null>;
  clearError: (repoId: string, scope?: SandboxStateScope) => void;
  stop: (recordId: string) => Promise<void>;
  pause: (recordId: string) => Promise<void>;
  resume: (recordId: string) => Promise<SandboxRecord | null>;
  deleteRecord: (recordId: string) => Promise<void>;
  refresh: () => Promise<void>;
  getSandboxForRepo: (
    repoId: string,
    options?: {
      sandboxId?: string | null;
      workingBranch?: string | null;
      rootDirectory?: string | null;
    }
  ) => SandboxRecord | null;
  listSandboxesForRepo: (repoId: string) => SandboxRecord[];
  getSandboxById: (recordId: string) => SandboxRecord | null;
  isCreating: (repoId: string, scope?: SandboxStateScope) => boolean;
  hasCreatingForRepo: (repoId: string) => boolean;
  appendLog: (repoId: string, text: string, scope?: SandboxStateScope) => void;
  getLaunchError: (
    repoId: string,
    scope?: SandboxStateScope
  ) => SandboxError | null;
  getLaunchLogs: (repoId: string, scope?: SandboxStateScope) => string;
  updateStatus: (recordId: string, status: SandboxLifecycleStatus) => void;
  extend: (recordId: string, minutes: number) => Promise<void>;
};

const SANDBOX_STATUS_PRIORITY: Record<SandboxLifecycleStatus, number> = {
  running: 0,
  installing: 1,
  creating: 2,
  pausing: 3,
  paused: 4,
  error: 5,
  stopped: 6,
};

function compareSandboxRecords(a: SandboxRecord, b: SandboxRecord) {
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

function rebuildSandboxIndexes(
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

function withSandboxRecord(
  indexes: SandboxStateIndexes,
  record: SandboxRecord
): SandboxStateIndexes {
  return rebuildSandboxIndexes({
    ...indexes.sandboxesById,
    [record.id]: toSandboxRecord(record),
  });
}

function withoutSandboxRecord(
  indexes: SandboxStateIndexes,
  recordId: string
): SandboxStateIndexes {
  const { [recordId]: _removed, ...remaining } = indexes.sandboxesById;
  return rebuildSandboxIndexes(remaining);
}

function normalizeSandboxStateKeySegment(
  value: string | null | undefined,
  fallback: string
) {
  return typeof value === "string" && value.trim()
    ? `v-${encodeURIComponent(value.trim())}`
    : fallback;
}

/**
 * Key format: `${repoId}:${workingBranch}:${rootDirectory}`.
 * Sentinels: `u` = omitted/unspecified, `n` = explicit repo root,
 * `v-{encoded}` = literal value. Legacy two-segment keys are parsed
 * by parseSandboxStateKey for backward compatibility.
 */
export function buildSandboxStateKey(
  repoId: string,
  workingBranch?: string | null,
  rootDirectory?: string | null
) {
  const normalizedWorkingBranch = normalizeSandboxStateKeySegment(
    workingBranch,
    "u"
  );
  const normalizedRootDirectory =
    rootDirectory === null
      ? "n"
      : normalizeSandboxStateKeySegment(rootDirectory, "u");
  return `${repoId}:${normalizedWorkingBranch}:${normalizedRootDirectory}`;
}

function buildLaunchKey(
  repoId: string,
  launchRequest?: SandboxLaunchRequestInput
) {
  return buildSandboxStateKey(
    repoId,
    launchRequest?.workingBranch,
    launchRequest?.rootDirectory
  );
}

function parseSandboxStateValueSegment(
  segment: string | undefined,
  options?: { nullValue?: boolean }
) {
  // Bare "default" is only a legacy unencoded sentinel. New literal values are
  // prefixed with "v-" so branches or roots named "default" round-trip.
  if (!segment || segment === "u" || segment === "default") return undefined;
  // "n" is the canonical repo-root encoding; "root" is a legacy alias from
  // early rootDirectory keys before value prefixes were introduced.
  if (options?.nullValue && (segment === "n" || segment === "root")) {
    return null;
  }
  // Malformed literal or legacy segments are ignored instead of breaking state lookup.
  try {
    if (segment.startsWith("v-")) {
      return decodeURIComponent(segment.slice(2));
    }
    return decodeURIComponent(segment);
  } catch {
    return undefined;
  }
}

export function parseSandboxStateKey(repoId: string, stateKey: string) {
  const prefix = `${repoId}:`;
  if (!stateKey.startsWith(prefix)) {
    return {
      workingBranch: undefined,
      rootDirectory: undefined,
    };
  }

  const [workingBranchSegment, rootDirectorySegment] = stateKey
    .slice(prefix.length)
    .split(":");
  return {
    workingBranch: parseSandboxStateValueSegment(workingBranchSegment) as
      | string
      | undefined,
    rootDirectory: parseSandboxStateValueSegment(rootDirectorySegment, {
      nullValue: true,
    }) as string | null | undefined,
  };
}

function isBranchOnlyScope(scope?: SandboxStateScope) {
  return Boolean(scope?.workingBranch && scope.rootDirectory === undefined);
}

function hasConcreteSandboxStateScope(scope?: SandboxStateScope) {
  return Boolean(
    scope?.sandboxId ||
    scope?.workingBranch ||
    scope?.rootDirectory !== undefined
  );
}

function findBranchScopedStateKeys(
  candidateKeys: Iterable<string>,
  repoId: string,
  workingBranch: string
) {
  const matches: string[] = [];
  for (const stateKey of candidateKeys) {
    const parsed = parseSandboxStateKey(repoId, stateKey);
    if (parsed.workingBranch === workingBranch) {
      matches.push(stateKey);
    }
  }
  return matches;
}

function resolveSandboxStateKeys(
  state: Pick<SandboxStore, "sandboxesById">,
  repoId: string,
  scope: SandboxStateScope | undefined,
  candidateKeys: Iterable<string>
) {
  if (isBranchOnlyScope(scope)) {
    const matches = findBranchScopedStateKeys(
      candidateKeys,
      repoId,
      scope?.workingBranch ?? ""
    );
    if (matches.length > 0) return matches;
  }

  return [resolveSandboxStateKey(state, repoId, scope)];
}

function resolveSandboxStateKey(
  state: Pick<SandboxStore, "sandboxesById">,
  repoId: string,
  scope?: SandboxStateScope
) {
  if (scope?.workingBranch || scope?.rootDirectory !== undefined) {
    return buildSandboxStateKey(
      repoId,
      scope?.workingBranch,
      scope?.rootDirectory
    );
  }

  if (scope?.sandboxId) {
    const sandbox = state.sandboxesById[scope.sandboxId];
    if (sandbox?.repo_id === repoId) {
      return buildSandboxStateKey(
        repoId,
        sandbox.working_branch,
        sandbox.root_directory
      );
    }
  }

  return buildSandboxStateKey(repoId);
}

function resolveFallbackSandboxStateKey(repoId: string) {
  return buildSandboxStateKey(repoId);
}

function parseSseLines(buffer: string): {
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

function incrementCreatingState(state: SandboxStore, stateKey: string) {
  const nextCount = (state.creatingCounts[stateKey] ?? 0) + 1;
  return {
    creatingCounts: {
      ...state.creatingCounts,
      [stateKey]: nextCount,
    },
    creating: new Set([...state.creating, stateKey]),
  };
}

function decrementCreatingState(state: SandboxStore, stateKey: string) {
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

function hasCreatingLaunchForRepo(
  creating: ReadonlySet<string>,
  repoId: string
) {
  const repoPrefix = `${repoId}:`;
  for (const stateKey of creating) {
    if (stateKey.startsWith(repoPrefix)) return true;
  }
  return false;
}

function applyLaunchSandboxRecord(
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

function buildSandboxLaunchError(
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
  launchAttemptId?: string
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
            {
              ...launchScope,
            }
          );
          break;
        case "log":
          get().appendLog(repoId, event.data, {
            ...launchScope,
          });
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

  if (finalSandbox) {
    return finalSandbox;
  }

  await get().refresh();
  return get().getSandboxForRepo(repoId, {
    ...launchScope,
  });
}

export const useSandboxStore = create<SandboxStore>((set, get) => ({
  sandboxes: {},
  sandboxesById: {},
  sandboxIdsByRepoId: {},
  activeSandboxId: null,
  creating: new Set(),
  creatingCounts: {},
  errors: {},
  logs: {},

  setActiveSandbox: (id) => set({ activeSandboxId: id }),

  setSandboxRecord: (record) =>
    set((state) => {
      const nextIndexes = withSandboxRecord(state, record);
      return {
        ...nextIndexes,
        activeSandboxId:
          state.activeSandboxId === record.id &&
          (record.runtime_summary.status === "stopped" ||
            record.runtime_summary.status === "error")
            ? null
            : record.runtime_summary.status === "running" ||
                record.runtime_summary.status === "installing" ||
                record.runtime_summary.status === "creating"
              ? record.id
              : state.activeSandboxId,
      };
    }),

  applySandboxPatch: (record) =>
    set((state) => {
      const existing = state.sandboxesById[record.id];
      const repoId = record.repo_id ?? existing?.repo_id;
      if (!repoId) return state;

      const next = mergeSandboxRecord(existing, record, repoId);
      const nextIndexes = withSandboxRecord(state, next);
      return {
        ...nextIndexes,
        activeSandboxId:
          state.activeSandboxId === next.id &&
          (next.runtime_summary.status === "stopped" ||
            next.runtime_summary.status === "error")
            ? null
            : state.activeSandboxId,
      };
    }),

  clearError: (repoId, scope) =>
    set((state) => {
      const stateKeys = resolveSandboxStateKeys(
        state,
        repoId,
        scope,
        Object.keys(state.errors)
      );
      const rest = { ...state.errors };
      for (const stateKey of stateKeys) {
        delete rest[stateKey];
      }
      return { errors: rest };
    }),

  appendLog: (repoId, text, scope) =>
    set((state) => {
      const stateKey = resolveSandboxStateKey(state, repoId, scope);
      return {
        logs: {
          ...state.logs,
          [stateKey]: (state.logs[stateKey] || "") + text,
        },
      };
    }),

  getLaunchError: (repoId, scope) => {
    const state = get();
    const stateKeys = resolveSandboxStateKeys(
      state,
      repoId,
      scope,
      Object.keys(state.errors)
    );
    for (const stateKey of stateKeys) {
      if (state.errors[stateKey]) return state.errors[stateKey];
    }
    if (hasConcreteSandboxStateScope(scope)) return null;
    return state.errors[resolveFallbackSandboxStateKey(repoId)] || null;
  },

  getLaunchLogs: (repoId, scope) => {
    const state = get();
    const stateKeys = resolveSandboxStateKeys(
      state,
      repoId,
      scope,
      Object.keys(state.logs)
    );
    for (const stateKey of stateKeys) {
      if (state.logs[stateKey]) return state.logs[stateKey];
    }
    if (hasConcreteSandboxStateScope(scope)) return "";
    return state.logs[resolveFallbackSandboxStateKey(repoId)] || "";
  },

  updateStatus: (recordId, newStatus) =>
    set((state) => {
      const existing = state.sandboxesById[recordId];
      if (!existing) return state;

      const nextIndexes = withSandboxRecord(
        state,
        mergeSandboxRecord(
          existing,
          { id: recordId, status: newStatus },
          existing.repo_id
        )
      );

      return {
        ...nextIndexes,
        activeSandboxId:
          state.activeSandboxId === recordId &&
          (newStatus === "stopped" || newStatus === "error")
            ? null
            : state.activeSandboxId,
      };
    }),

  launch: async (repoId, launchRequest, options) => {
    const launchKey = buildLaunchKey(repoId, launchRequest);
    if (launchingKeys.has(launchKey)) return null;
    launchingKeys.add(launchKey);
    const launchAttemptId =
      options?.launchAttemptId ?? createSandboxLaunchAttemptId();

    const state = get();
    const { [launchKey]: _error, ...restErrors } = state.errors;

    // launch() clears error/log upfront in a single set() because it has no
    // early-return path equivalent to restart()'s 409 guard — every code
    // path past this point either commits to a new attempt or surfaces a
    // new error in the catch below. If a future change adds such an
    // early-return, mirror restart()'s deferred-clear pattern to preserve
    // the prior actionable error across the early exit.
    set((current) => ({
      ...incrementCreatingState(current, launchKey),
      errors: restErrors,
      logs: { ...current.logs, [launchKey]: "" },
    }));

    try {
      const res = await fetch("/api/sandbox", {
        method: "POST",
        headers: getActiveTeamRequestHeaders({
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({ repoId, ...launchRequest }),
      });
      return await consumeSandboxLaunchResponse(
        repoId,
        launchKey,
        res,
        set,
        get,
        launchAttemptId
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Sandbox launch failed";
      toast({
        title: "Sandbox error",
        description: message,
        variant: "destructive",
      });
      set((current) => ({
        errors: {
          ...current.errors,
          [launchKey]: buildSandboxLaunchError(message, launchAttemptId),
        },
      }));
      return null;
    } finally {
      set((current) => decrementCreatingState(current, launchKey));
      launchingKeys.delete(launchKey);
    }
  },

  restart: async (repoId, options) => {
    const current = get().getSandboxForRepo(repoId, options);
    if (!current?.id) {
      return get().launch(repoId);
    }

    const launchKey = buildSandboxStateKey(
      repoId,
      current.working_branch,
      current.root_directory
    );
    const launchAttemptId = createSandboxLaunchAttemptId();
    // Reserve the creating slot before the fetch so the UI can disable the
    // restart button while we wait. Defer clearing the existing error/log
    // until we know we're committing to a real restart — otherwise the 409
    // early-return below silently discards an actionable error that was
    // stored at this launchKey by a prior failed attempt.
    set((state) => incrementCreatingState(state, launchKey));

    // Captured below the 409 guard so we can restore the log buffer if
    // consumeSandboxLaunchResponse throws before writing its own state
    // (e.g. a 500 JSON error response). The new error message in the catch
    // block intentionally replaces the prior error — the most recent
    // failure reason is the one the user needs to act on.
    let priorLog: string | undefined;

    try {
      const res = await fetch(`/api/sandbox/${current.id}/restart`, {
        method: "POST",
        headers: getActiveTeamRequestHeaders(),
      });
      // 409 from /restart means the original launch hasn't completed yet
      // (sandbox_id is still "pending"). That's a retry-later signal, not a
      // launch failure — surfacing it as one pins a "Sandbox launch failed"
      // overlay over the preview that succeeds moments later. The creating
      // counter incremented above is released by the finally block.
      if (res.status === 409) {
        toast({
          title: "Sandbox is still booting",
          description: "Wait for the current launch to finish, then try again.",
        });
        return current;
      }
      // Committing to a real restart — capture and then clear any stale
      // error and log buffer for this launchKey so the new attempt starts
      // from a clean slate. Capture happens before the clear so the catch
      // block can restore the log context on a synchronous failure.
      priorLog = get().logs[launchKey];
      set((state) => {
        const { [launchKey]: _error, ...restErrors } = state.errors;
        return {
          errors: restErrors,
          logs: { ...state.logs, [launchKey]: "" },
        };
      });
      return await consumeSandboxLaunchResponse(
        repoId,
        launchKey,
        res,
        set,
        get,
        launchAttemptId
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Sandbox restart failed";
      toast({
        title: "Sandbox error",
        description: message,
        variant: "destructive",
      });
      // Restore the prior log buffer alongside writing the new error so a
      // subscriber that read the cleared state recovers the context the
      // failure was reported against. The new error message overrides
      // priorError by design — the most recent failure is what the user
      // needs to act on.
      set((state) => ({
        errors: {
          ...state.errors,
          [launchKey]: buildSandboxLaunchError(message, launchAttemptId),
        },
        logs:
          priorLog === undefined
            ? state.logs
            : { ...state.logs, [launchKey]: priorLog },
      }));
      return null;
    } finally {
      set((state) => decrementCreatingState(state, launchKey));
    }
  },

  retryLaunch: (repoId, launchRequest) => get().launch(repoId, launchRequest),

  extend: async (recordId, minutes) => {
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
  },

  pause: async (recordId) => {
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
  },

  resume: async (recordId) => {
    const current = get().getSandboxById(recordId);
    if (!current) return null;
    const repoId = current.repo_id;
    const launchKey = buildSandboxStateKey(
      repoId,
      current.working_branch,
      current.root_directory
    );
    const launchAttemptId = createSandboxLaunchAttemptId();
    const { [launchKey]: _error, ...restErrors } = get().errors;
    set((state) => ({
      ...incrementCreatingState(state, launchKey),
      errors: restErrors,
      logs: { ...state.logs, [launchKey]: "" },
    }));

    try {
      const res = await fetch(`/api/sandbox/${recordId}/resume`, {
        method: "POST",
        headers: getActiveTeamRequestHeaders(),
      });
      return await consumeSandboxLaunchResponse(
        repoId,
        launchKey,
        res,
        set,
        get,
        launchAttemptId
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Sandbox resume failed";
      toast({
        title: "Resume failed",
        description: message,
        variant: "destructive",
      });
      set((state) => ({
        errors: {
          ...state.errors,
          [launchKey]: buildSandboxLaunchError(message, launchAttemptId),
        },
      }));
      return null;
    } finally {
      set((state) => decrementCreatingState(state, launchKey));
    }
  },

  stop: async (recordId) => {
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
          { id: recordId, status: "stopped", health_status: "stopped" },
          existing.repo_id
        )
      );

      return {
        ...nextIndexes,
        activeSandboxId:
          state.activeSandboxId === recordId ? null : state.activeSandboxId,
      };
    });
  },

  deleteRecord: async (recordId) => {
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
  },

  refresh: async () => {
    const res = await fetch("/api/sandbox");
    if (!res.ok) return;

    const { sandboxes } = await res.json();
    const sandboxesById: Record<string, SandboxRecord> = {};
    for (const sandbox of sandboxes) {
      const normalized = toSandboxRecord(sandbox);
      sandboxesById[normalized.id] = normalized;
    }

    set((state) => {
      const nextIndexes = rebuildSandboxIndexes(sandboxesById);
      const activeSandboxId = nextIndexes.sandboxesById[
        state.activeSandboxId ?? ""
      ]
        ? state.activeSandboxId
        : null;
      return {
        ...nextIndexes,
        activeSandboxId,
      };
    });
  },

  getSandboxForRepo: (repoId, options) => {
    const state = get();
    if (options?.sandboxId) {
      const sandbox = state.sandboxesById[options.sandboxId];
      if (sandbox?.repo_id === repoId) return sandbox;
      return null;
    }
    if (options?.workingBranch || options?.rootDirectory !== undefined) {
      return (
        state
          .listSandboxesForRepo(repoId)
          .find(
            (sandbox) =>
              (!options?.workingBranch ||
                sandbox.working_branch === options.workingBranch) &&
              (options?.rootDirectory === undefined ||
                (options?.rootDirectory === null
                  ? sandbox.root_directory == null
                  : sandbox.root_directory === options?.rootDirectory))
          ) || null
      );
    }
    return state.sandboxes[repoId] || null;
  },

  listSandboxesForRepo: (repoId) => {
    const state = get();
    const ids = state.sandboxIdsByRepoId[repoId] ?? [];
    return ids.map((id) => state.sandboxesById[id]).filter(Boolean);
  },

  getSandboxById: (recordId) => get().sandboxesById[recordId] || null,

  isCreating: (repoId, scope) => {
    const state = get();
    return resolveSandboxStateKeys(state, repoId, scope, state.creating).some(
      (stateKey) => state.creating.has(stateKey)
    );
  },

  hasCreatingForRepo: (repoId) =>
    hasCreatingLaunchForRepo(get().creating, repoId),
}));

export function useSandboxSync() {
  const { user } = useUser();
  const refresh = useSandboxStore((state) => state.refresh);
  const applySandboxPatch = useSandboxStore((state) => state.applySandboxPatch);

  useEffect(() => {
    if (!user?.id) return;

    void refresh();

    const supabase = createSupabaseClient();
    const channel = supabase
      .channel(`sandboxes:${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "sandboxes",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          if (payload.eventType === "DELETE" || !payload.new) {
            void refresh();
            return;
          }

          applySandboxPatch(payload.new as SandboxRecordPatch);
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user?.id, refresh, applySandboxPatch]);
}
