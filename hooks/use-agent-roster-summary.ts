import { useMemo } from "react";
import useSWR from "swr";
import { useRealtimeRouteRefresh } from "@/hooks/use-realtime-route-refresh";
import type { AgentRosterSummaryResponse } from "@/app/api/agents/roster/summary/route";

const fetcher = async (url: string): Promise<AgentRosterSummaryResponse> => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`API error: ${r.status}`);
  return r.json();
};

export function useAgentRosterSummary() {
  const { data, isLoading, mutate } = useSWR<AgentRosterSummaryResponse>(
    "/api/agents/roster/summary",
    fetcher
  );

  const realtimeSpecs = useMemo(
    () => [
      { table: "job_runs", filter: "user_id=eq.$USER_ID" },
      { table: "ai_calls", filter: "user_id=eq.$USER_ID" },
    ],
    []
  );

  useRealtimeRouteRefresh({
    channelName: "agent-roster-summary",
    specs: realtimeSpecs,
    onInvalidate: mutate,
  });

  return { summary: data ?? {}, isLoading, mutate };
}
