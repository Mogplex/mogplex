"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  const activeSessionIdRef = useRef(input.sessionId);
  const refreshRevisionRef = useRef(0);

  useEffect(() => {
    activeSessionIdRef.current = input.sessionId;
    refreshRevisionRef.current += 1;
  }, [input.sessionId]);

  const refresh = useCallback(async () => {
    const sessionId = input.sessionId;
    const revision = refreshRevisionRef.current + 1;
    refreshRevisionRef.current = revision;
    if (!sessionId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const response = await fetch(
        `/api/control/worktrees?sessionId=${encodeURIComponent(sessionId)}`
      );
      if (!response.ok) return;
      const body = (await response.json()) as {
        worktrees?: OrchestrationWorktreeDTO[];
      };
      if (
        revision !== refreshRevisionRef.current ||
        sessionId !== activeSessionIdRef.current
      ) {
        return;
      }
      setResult({
        sessionId,
        worktrees: body.worktrees ?? [],
      });
    } catch (error) {
      console.warn("[control] failed to refresh worktrees", error);
    } finally {
      if (revision === refreshRevisionRef.current) setLoading(false);
    }
  }, [input.sessionId]);

  useEffect(() => {
    void refresh();
  }, [refresh, input.chatPending]);

  const act = useCallback(
    async (
      action: "rebase" | "archive" | "prune",
      worktreeId: string,
      options: { force?: boolean } = {}
    ) => {
      const response = await fetch("/api/control/worktrees", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          worktreeId,
          sessionId: input.sessionId,
          force: options.force === true,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        forceEligible?: boolean;
      };
      if (!response.ok) {
        throw Object.assign(new Error(body.error || "Worktree action failed"), {
          forceEligible: body.forceEligible === true,
        });
      }
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
