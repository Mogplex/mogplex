"use client";

import { useEffect } from "react";
import { create } from "zustand";

import { mergeSandboxRecord } from "@/lib/sandbox/client-record";
import { createSandboxLaunchAttemptId } from "@/lib/sandbox/error-state";
import { createClient as createSupabaseClient } from "@/lib/supabase/client";
import { getActiveTeamRequestHeaders } from "@/components/active-scope-provider";
import { toast } from "@/hooks/use-toast";
import { useTableEvents } from "@/hooks/use-table-events";
import { useUser } from "@/hooks/use-user";
import {
  buildLaunchKey,
  buildSandboxStateKey,
  hasConcreteSandboxStateScope,
  resolveFallbackSandboxStateKey,
  resolveSandboxStateKey,
  resolveSandboxStateKeys,
} from "./sandbox-state-keys";
import {
  buildSandboxLaunchError,
  consumeSandboxLaunchResponse,
  decrementCreatingState,
  executeDeleteRecord,
  executeExtend,
  executePause,
  executeRefresh,
  executeStop,
  hasCreatingLaunchForRepo,
  incrementCreatingState,
  withSandboxRecord,
} from "./sandbox-store-helpers";

import type { SandboxRecordPatch } from "@/lib/sandbox/client-record";
import type { SandboxStore } from "./sandbox-store-types";

// Re-export public types and functions
export type { SandboxStateScope, SandboxStore } from "./sandbox-store-types";
export {
  buildSandboxStateKey,
  parseSandboxStateKey,
} from "./sandbox-state-keys";
export { consumeSandboxLaunchResponse } from "./sandbox-store-helpers";

const launchingKeys = new Set<string>();

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
    if (!current?.id) return get().launch(repoId);

    const launchKey = buildSandboxStateKey(
      repoId,
      current.working_branch,
      current.root_directory
    );
    const launchAttemptId = createSandboxLaunchAttemptId();
    set((state) => incrementCreatingState(state, launchKey));

    let priorLog: string | undefined;

    try {
      const res = await fetch(`/api/sandbox/${current.id}/restart`, {
        method: "POST",
        headers: getActiveTeamRequestHeaders(),
      });
      if (res.status === 409) {
        toast({
          title: "Sandbox is still booting",
          description: "Wait for the current launch to finish, then try again.",
        });
        return current;
      }
      priorLog = get().logs[launchKey];
      set((state) => {
        const { [launchKey]: _error, ...restErrors } = state.errors;
        return { errors: restErrors, logs: { ...state.logs, [launchKey]: "" } };
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

  extend: (recordId, minutes) => executeExtend(recordId, minutes, set),

  pause: (recordId) => executePause(recordId, set, get),

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

  stop: (recordId) => executeStop(recordId, set, get),

  deleteRecord: (recordId) => executeDeleteRecord(recordId, set),

  refresh: () => executeRefresh(set),

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

const useNeonBackend = process.env.NEXT_PUBLIC_MOGPLEX_DATA_BACKEND === "neon";

export function useSandboxSync() {
  const { user } = useUser();
  const refresh = useSandboxStore((state) => state.refresh);
  const applySandboxPatch = useSandboxStore((state) => state.applySandboxPatch);

  useEffect(() => {
    if (!user?.id) return;
    void refresh();
  }, [user?.id, refresh]);

  useTableEvents({
    tables: ["sandboxes"],
    enabled: useNeonBackend && Boolean(user?.id),
    onEvent: () => {
      void refresh();
    },
  });

  useEffect(() => {
    if (useNeonBackend || !user?.id) return;
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
