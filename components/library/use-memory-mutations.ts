"use client";

import { useState } from "react";
import type { MemoryLane, MemoryResourceScope } from "./context-section-types";
import { requestHeaders } from "./context-section-utils";

type WriteScope = Exclude<MemoryResourceScope, "all">;

export interface MemoryMutationContext {
  lane: MemoryLane;
  writeScope: WriteScope;
  activeTeamId: string | null;
  selectedRepoId: string | null;
  workspaceSessionId: string | null;
  /** Re-fetch the memory list after a successful write. */
  refresh: () => Promise<unknown>;
}

/**
 * All writes the memories widget performs, with shared busy/error state.
 * Every request goes through `run`, which surfaces the server's error message
 * and refreshes the list only after the write succeeded.
 */
export function useMemoryMutations(ctx: MemoryMutationContext) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const jsonHeaders = () =>
    requestHeaders({
      resourceScope: ctx.writeScope,
      activeTeamId: ctx.activeTeamId,
      json: true,
    });

  const run = async (
    id: string,
    action: () => Promise<Response>,
    failureMessage: string
  ): Promise<boolean> => {
    setBusyId(id);
    setError(null);
    try {
      const res = await action();
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(payload?.error || failureMessage);
      }
      await ctx.refresh();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : failureMessage);
      return false;
    } finally {
      setBusyId(null);
    }
  };

  const addMemory = (content: string) =>
    run(
      "create",
      () =>
        fetch("/api/memories", {
          method: "POST",
          headers: jsonHeaders(),
          body: JSON.stringify({
            lane: ctx.lane,
            content,
            repoId: ctx.selectedRepoId,
            workspaceSessionId: ctx.workspaceSessionId,
            resourceScope: ctx.writeScope,
            source: "memories-pane",
          }),
        }),
      "Failed to add memory"
    );

  const saveMemory = (id: string, content: string) =>
    run(
      id,
      () =>
        fetch("/api/memories", {
          method: "PATCH",
          headers: jsonHeaders(),
          body: JSON.stringify({ id, content }),
        }),
      "Failed to update memory"
    );

  const deleteMemory = (id: string) =>
    run(
      id,
      () =>
        fetch(`/api/memories?id=${id}`, {
          method: "DELETE",
          headers: requestHeaders({
            resourceScope: ctx.writeScope,
            activeTeamId: ctx.activeTeamId,
          }),
        }),
      "Failed to delete memory"
    );

  /** Stale session notes plus machine-generated noise, in one action. */
  const pruneMemories = () =>
    run(
      "prune",
      async () => {
        const compact = await fetch("/api/memories/actions", {
          method: "POST",
          headers: jsonHeaders(),
          body: JSON.stringify({ action: "compact" }),
        });
        if (!compact.ok) return compact;
        return fetch("/api/memories/actions", {
          method: "POST",
          headers: jsonHeaders(),
          body: JSON.stringify({ action: "prune_noise" }),
        });
      },
      "Failed to prune memories"
    );

  const checkpoint = () =>
    run(
      "checkpoint",
      () =>
        fetch("/api/memories/actions", {
          method: "POST",
          headers: jsonHeaders(),
          body: JSON.stringify({
            action: "checkpoint",
            lane: ctx.lane,
            repoId: ctx.selectedRepoId,
            workspaceSessionId: ctx.workspaceSessionId,
            resourceScope: ctx.writeScope,
            source: "memories-pane",
          }),
        }),
      "Failed to create checkpoint"
    );

  return {
    busyId,
    error,
    addMemory,
    saveMemory,
    deleteMemory,
    pruneMemories,
    checkpoint,
  };
}
