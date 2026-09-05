"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { useRealtimeRouteRefresh } from "@/hooks/use-realtime-route-refresh";
import type { ControlWorker } from "@/lib/control/workers";
import { projectRunTranscript } from "@/lib/run-workspace/transcript";

const SPECS = [
  "external_agent_runs",
  "ai_call_events",
  "orchestration_worktrees",
].map((table) => ({
  table,
  filter: "user_id=eq.$USER_ID",
}));
const EMPTY_WORKERS: ControlWorker[] = [];

async function fetchWorkers(
  url: string
): Promise<{ workers: ControlWorker[] }> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Could not load worker status. Try again.");
  return response.json();
}

export function useControlWorkers(
  sessionId: string | null,
  chatPending: boolean
) {
  const [connection, setConnection] = useState<
    "connecting" | "connected" | "disconnected"
  >("connecting");
  const { data, error, mutate, isLoading } = useSWR(
    sessionId
      ? `/api/control/workers?sessionId=${encodeURIComponent(sessionId)}`
      : null,
    fetchWorkers,
    { refreshInterval: 0, shouldRetryOnError: false }
  );
  useRealtimeRouteRefresh({
    channelName: "control-workers",
    specs: SPECS,
    enabled: Boolean(sessionId),
    onInvalidate: mutate,
    onConnectionChange: setConnection,
  });
  useEffect(() => {
    if (!chatPending) void mutate();
  }, [chatPending, mutate]);
  const workers = data?.workers ?? EMPTY_WORKERS;
  const messages = useMemo(
    () =>
      workers.flatMap((worker) =>
        projectRunTranscript(worker.id, "", worker.events, worker.status)
          .filter((message) => message.role === "assistant")
          .map((message) => ({
            ...message,
            metadata: { workerBranch: worker.branch },
          }))
      ),
    [workers]
  );
  return {
    workers,
    messages,
    error: error
      ? "Could not load worker status. Try again."
      : workers.length > 0 && connection === "disconnected"
        ? "Live updates disconnected. Displayed status may be out of date."
        : null,
    loading: isLoading,
    refresh: mutate,
  };
}
