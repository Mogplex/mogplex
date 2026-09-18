"use client";
import useSWR from "swr";
import type { AgentUsageMap } from "@/lib/agents/usage";

const fetchUsage = async (url: string): Promise<AgentUsageMap> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to load agent usage");
  return (await res.json()) as AgentUsageMap;
};

/** Where each roster agent is used: published automations and recorded runs. */
export function useAgentUsage() {
  const { data, error, isLoading, mutate } = useSWR<AgentUsageMap>(
    "/api/agents/usage",
    fetchUsage
  );
  return { usage: data ?? {}, error, isLoading, mutate };
}
