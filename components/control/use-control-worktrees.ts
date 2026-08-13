"use client";

import { useCallback, useEffect, useState } from "react";
import type { OrchestrationWorktreeDTO } from "@/lib/worktrees/types";

export function useControlWorktrees(input: {
  sessionId: string | null;
  chatPending: boolean;
}) {
  const [result, setResult] = useState<{
    sessionId: string;
    worktrees: OrchestrationWorktreeDTO[];
  }>({ sessionId: "", worktrees: [] });
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!input.sessionId) {
      return;
    }
    setLoading(true);
    try {
      const response = await fetch(
        `/api/control/worktrees?sessionId=${encodeURIComponent(input.sessionId)}`
      );
      if (!response.ok) return;
      const body = (await response.json()) as {
        worktrees?: OrchestrationWorktreeDTO[];
      };
      setResult({
        sessionId: input.sessionId,
        worktrees: body.worktrees ?? [],
      });
    } catch (error) {
      console.warn("[control] failed to refresh worktrees", error);
    } finally {
      setLoading(false);
    }
  }, [input.sessionId]);

  useEffect(() => {
    void refresh();
  }, [refresh, input.chatPending]);

  const act = useCallback(
    async (action: "rebase" | "archive" | "prune", worktreeId: string) => {
      const response = await fetch("/api/control/worktrees", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          worktreeId,
          sessionId: input.sessionId,
          force: action === "prune",
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) throw new Error(body.error || "Worktree action failed");
      await refresh();
    },
    [input.sessionId, refresh]
  );

  const loadDiff = useCallback(
    async (worktreeId: string) => {
      const query = new URLSearchParams({
        worktreeId,
        sessionId: input.sessionId ?? "",
      });
      const response = await fetch(
        `/api/control/worktrees?${query.toString()}`
      );
      const body = (await response.json().catch(() => ({}))) as {
        diff?: string;
        error?: string;
      };
      if (!response.ok) throw new Error(body.error || "Failed to load diff");
      return body.diff ?? "";
    },
    [input.sessionId]
  );

  const worktrees =
    result.sessionId === input.sessionId ? result.worktrees : [];
  return { worktrees, loading, refresh, act, loadDiff };
}
