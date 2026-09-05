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

  useEffect(() => {
    const source = new EventSource(`/api/runs/${runId}/stream`);
    let active = true;
    source.addEventListener("open", () => setConnection("Connected"));
    source.addEventListener("run", (event) => {
      try {
        const data = JSON.parse(event.data);
        active = isRunActive(String(data.status));
      } catch {
        setConnection("Could not read run status");
      }
    });
    source.addEventListener("replay_complete", () => {
      // Replayed events do not include sandbox assignment or saved guidance.
      // Reconcile the owned snapshot even if no table event follows the gap.
      void reload();
      setConnection(active ? "Live" : "History loaded");
      if (!active) source.close();
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
          setConnection("History loaded");
          void reload();
        }
      } catch {
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
  }, [runId, reload]);
  const terminal = events.findLast((event) =>
    ["finished", "failed", "cancelled"].includes(event.type)
  );
  const status = terminal
    ? terminal.type === "finished"
      ? "success"
      : terminal.type
    : (context?.status ?? "pending");
  return { context, events, status, connection, error, reload };
}
