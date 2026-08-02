"use client";
import useSWR from "swr";
import {
  getActiveTeamRequestHeaders,
  useActiveTeamId,
} from "@/components/active-scope-provider";
import { fetchJsonArray } from "@/lib/client-fetch";
import type { Agent } from "@/lib/types";

// The active team is part of the SWR key: /api/agents stamps preset models
// per scope (team allowlist/capabilities/keys), so cached personal-scope data
// must not be served in team scope or vice versa.
const fetchAgents = ([url, teamId]: readonly [string, string | null]) =>
  fetchJsonArray<Agent>(url, "Failed to load agents", {
    headers: getActiveTeamRequestHeaders(undefined, teamId),
  });

export function useAgents() {
  const activeTeamId = useActiveTeamId();
  const { data, error, isLoading, mutate } = useSWR<Agent[]>(
    ["/api/agents", activeTeamId] as const,
    fetchAgents
  );
  return { agents: data ?? [], isLoading, error, mutate };
}
