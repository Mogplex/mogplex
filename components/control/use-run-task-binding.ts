"use client";
import useSWR from "swr";
import { fetchJsonObject } from "@/lib/client-fetch";
import { runWorkspaceSchema } from "@/lib/run-workspace/types";
import { useRealtimeRouteRefresh } from "@/hooks/use-realtime-route-refresh";

export function useRunTaskBinding(runId: string | null | undefined) {
  const { data, mutate } = useSWR(
    runId ? `/api/runs/${runId}/workspace` : null,
    async (url: string) =>
      runWorkspaceSchema.parse(
        await fetchJsonObject(url, "Could not load this run")
      )
  );
  useRealtimeRouteRefresh({
    channelName: "control-run-environment",
    specs: [{ table: "external_agent_runs", filter: `id=eq.${runId}` }],
    enabled: Boolean(runId),
    onInvalidate: () => mutate(),
  });
  return data?.sandboxRecordId
    ? {
        sandboxId: data.sandboxRecordId,
        callId: `run:${runId}:${data.sandboxRecordId}`,
      }
    : null;
}
