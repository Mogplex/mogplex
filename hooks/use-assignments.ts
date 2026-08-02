"use client";
import useSWR from "swr";
import { useRealtimeRouteRefresh } from "@/hooks/use-realtime-route-refresh";
import { fetchJsonArray } from "@/lib/client-fetch";
import type { Assignment, Repo, Agent } from "@/lib/types";

const fetchAssignments = (url: string) =>
  fetchJsonArray<Assignment>(url, "Failed to load assignments");
const fetchRepos = (url: string) =>
  fetchJsonArray<Repo>(url, "Failed to load repos");
const fetchAgents = (url: string) =>
  fetchJsonArray<Agent>(url, "Failed to load agents");

export function useAssignments() {
  const { data, error, isLoading, mutate } = useSWR<Assignment[]>(
    "/api/assignments",
    fetchAssignments
  );
  const { data: repos } = useSWR<Repo[]>("/api/repos", fetchRepos);
  const { data: agents } = useSWR<Agent[]>("/api/agents", fetchAgents);

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
    repos: repos ?? [],
    agents: agents ?? [],
    isLoading,
    error,
    mutate,
  };
}
