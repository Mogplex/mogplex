"use client";
import useSWR from "swr";
import {
  getActiveTeamRequestHeaders,
  useActiveTeamId,
} from "@/components/active-scope-provider";
import { fetchJsonArray } from "@/lib/client-fetch";
import type { Repo } from "@/lib/types";

const fetcher = (url: string, activeTeamId: string | null) =>
  fetchJsonArray<Repo>(url, "Failed to load repos", {
    headers: getActiveTeamRequestHeaders(undefined, activeTeamId),
  });

export function useRepos(
  options: {
    teamId?: string | null;
    showHidden?: boolean;
    enabled?: boolean;
  } = {}
) {
  const activeTeamId = useActiveTeamId();
  const teamId = options.teamId === undefined ? activeTeamId : options.teamId;
  const url = options.showHidden ? "/api/repos?show_hidden=true" : "/api/repos";
  const { data, error, isLoading, mutate } = useSWR<Repo[], Error>(
    options.enabled === false ? null : [url, teamId],
    ([url, teamId]: [string, string | null]) => fetcher(url, teamId)
  );
  return { repos: data ?? [], isLoading, error, mutate };
}
