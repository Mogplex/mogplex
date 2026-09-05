"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTableEvents } from "@/hooks/use-table-events";
import { useSessionsStore } from "@/hooks/use-sessions";
import {
  isRunActive,
  runEventSchema,
  runWorkspaceSchema,
  type RunWorkspaceContext,
  type RunWorkspaceEvent,
} from "@/lib/run-workspace/types";

export function useExternalRun(runId: string) {
  const [context, setContext] = useState<RunWorkspaceContext | null>(null);
  const [events, setEvents] = useState<RunWorkspaceEvent[]>([]);
  const [replayedRunId, setReplayedRunId] = useState<string | null>(null);
  const [connection, setConnection] = useState("Connecting to run…");
  const [error, setError] = useState<string | null>(null);
  const requestVersion = useRef(0);
  const invalidateRequests = useCallback(() => {
    requestVersion.current++;
  }, []);
  const reload = useCallback(
    async (signal?: AbortSignal) => {
      const version = ++requestVersion.current;
      try {
        const res = await fetch(`/api/runs/${runId}/workspace`, { signal });
        if (!res.ok)
          throw new Error(
            "Could not load this run. Check access and try again."
          );
        const data = runWorkspaceSchema.parse(await res.json());
        if (signal?.aborted || version !== requestVersion.current) return;
        setContext(data);
        setError(null);
        useSessionsStore.setState((state) => ({
          sessions: state.sessions.map((session) =>
            session.externalRunId === runId
              ? {
                  ...session,
                  activeSandboxId: data.sandboxRecordId,
                  pendingSandboxBranch: data.sandboxRecordId
                    ? null
                    : data.workingBranch,
                }
              : session
          ),
        }));
      } catch (cause) {
        if (!signal?.aborted && version === requestVersion.current)
          setError(
            cause instanceof Error ? cause.message : "Could not load run"
          );
      }
    },
    [runId]
  );
  useTableEvents({
    tables: ["external_agent_runs", "ai_calls", "sandboxes"],
    onEvent: () => {
      void reload();
    },
    onConnectionChange: (state) => {
      if (state === "connected") void reload();
    },
  });
  useEffect(() => {
    const controller = new AbortController();
    void reload(controller.signal);
    return () => {
      controller.abort();
      invalidateRequests();
    };
  }, [reload, invalidateRequests]);

  // The server closes a checkpoint replay. Reopen when the owned snapshot
  // leaves that checkpoint, without polling or remounting the workspace.
  const streamPhase =
    context?.runId === runId
      ? context.status === "awaiting_input"
        ? "paused"
        : "ready"
      : "loading";
  useEffect(() => {
    if (streamPhase === "loading") return;
    const source = new EventSource(`/api/runs/${runId}/stream`);
    let active = true;
    let readable = true;
    source.addEventListener("open", () => setConnection("Connected"));
    source.addEventListener("run", (event) => {
      try {
        const data = JSON.parse(event.data);
        active = isRunActive(String(data.status));
      } catch {
        readable = false;
        setConnection("Could not read run status");
      }
    });
    source.addEventListener("replay_complete", () => {
      // Replayed events do not include sandbox assignment or saved guidance.
      // Reconcile the owned snapshot even if no table event follows the gap.
      void reload();
      setConnection(
        readable
          ? active
            ? "Live"
            : "History loaded"
          : "Could not read saved history. Reload to reconnect."
      );
      if (!active) {
        if (readable) setReplayedRunId(runId);
        source.close();
      }
    });
    const receive = (event: MessageEvent) => {
      try {
        const data = runEventSchema.parse(JSON.parse(event.data));
        setEvents((current) =>
          current.some((item) => item.id === data.id)
            ? current
            : [...current, data]
        );
        setConnection("Live");
        if (["finished", "failed", "cancelled"].includes(data.type)) {
          source.close();
          setConnection(
            readable
              ? "History loaded"
              : "Could not read saved history. Reload to reconnect."
          );
          if (readable) setReplayedRunId(runId);
          void reload();
        }
      } catch {
        readable = false;
        setReplayedRunId(null);
        setConnection("Could not read a run update. Reload to reconnect.");
      }
    };
    for (const name of [
      "started",
      "log",
      "tool_started",
      "tool_finished",
      "finished",
      "failed",
      "cancelled",
      "cancel_requested",
    ])
      source.addEventListener(name, receive);
    source.addEventListener("error", () =>
      setConnection("Connection interrupted. Reconnecting…")
    );
    return () => source.close();
  }, [runId, reload, streamPhase]);
  const terminal = events.findLast((event) =>
    ["finished", "failed", "cancelled"].includes(event.type)
  );
  const status = terminal
    ? terminal.type === "finished"
      ? "success"
      : terminal.type
    : (context?.status ?? "pending");
  return {
    context,
    events,
    status,
    connection,
    error,
    reload,
    historyReady:
      replayedRunId === runId &&
      context !== null &&
      ["success", "failed", "cancelled"].includes(context.status),
  };
}
