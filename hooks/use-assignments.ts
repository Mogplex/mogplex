"use client";
import useSWR from "swr";
import { useRealtimeRouteRefresh } from "@/hooks/use-realtime-route-refresh";
import { fetchJsonArray } from "@/lib/client-fetch";
import type { Assignment, Agent } from "@/lib/types";
import { useRepos } from "@/hooks/use-repos";
import {
  getActiveTeamRequestHeaders,
  useActiveTeamId,
} from "@/components/active-scope-provider";

const fetchAssignments = ([url, teamId]: [string, string | null]) =>
  fetchJsonArray<Assignment>(url, "Failed to load assignments", {
    headers: getActiveTeamRequestHeaders(undefined, teamId),
  });
const fetchAgents = ([url, teamId]: [string, string | null]) =>
  fetchJsonArray<Agent>(url, "Failed to load agents", {
    headers: getActiveTeamRequestHeaders(undefined, teamId),
  });

export function useAssignments() {
  const teamId = useActiveTeamId();
  const { data, error, isLoading, mutate } = useSWR<Assignment[]>(
    ["/api/assignments", teamId],
    fetchAssignments
  );
  const { repos } = useRepos();
  const { data: agents } = useSWR<Agent[]>(
    ["/api/agents", teamId],
    fetchAgents
  );

  useRealtimeRouteRefresh({
    channelName: "assignments-page",
    specs: [
      { table: "assignments" },
      { table: "repos", filter: "user_id=eq.$USER_ID" },
      { table: "agents", filter: "user_id=eq.$USER_ID" },
      { table: "job_runs" },
      { table: "automation_dispatch_events", filter: "user_id=eq.$USER_ID" },
    ],
    onInvalidate: mutate,
  });

  return {
    assignments: data ?? [],
    repos,
    agents: agents ?? [],
    isLoading,
    error,
    mutate,
  };
}
