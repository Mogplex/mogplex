"use client";

import { useState } from "react";
import useSWR from "swr";
import { useRealtimeRouteRefresh } from "./use-realtime-route-refresh";
import {
  OBSERVABILITY_JOBS_REALTIME_SPECS,
  USER_AI_CALL_EVENTS_REALTIME_SPEC,
} from "@/lib/observability/realtime-specs";
import type { ObservabilityJobDetail } from "@/lib/types";

async function fetchDetail(
  url: string
): Promise<{ run: ObservabilityJobDetail; receivedAt: string }> {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(
      response.status === 404
        ? "This run is unavailable or you no longer have access."
        : "Run details could not be refreshed. Try again."
    );
  const body = await response.json();
  if (
    !body?.run ||
    typeof body.run.id !== "string" ||
    !Array.isArray(body.run.ai_calls) ||
    !Array.isArray(body.run.dispatch_events)
  )
    throw new Error("Run details were incomplete. Try again.");
  return { run: body.run, receivedAt: new Date().toISOString() };
}

export function useObservabilityRunDetail(id: string, source: string) {
  const [connection, setConnection] = useState<
    "connecting" | "connected" | "disconnected"
  >("connecting");
  const { data, error, isLoading, isValidating, mutate } = useSWR(
    `/api/observability/jobs/${encodeURIComponent(id)}?source=${encodeURIComponent(source)}`,
    fetchDetail,
    { shouldRetryOnError: false }
  );
  useRealtimeRouteRefresh({
    channelName: `run-inspector:${id}`,
    specs: [
      ...OBSERVABILITY_JOBS_REALTIME_SPECS,
      USER_AI_CALL_EVENTS_REALTIME_SPEC,
    ],
    onInvalidate: mutate,
    onConnectionChange: setConnection,
  });
  return { data, error, isLoading, isValidating, refresh: mutate, connection };
}
