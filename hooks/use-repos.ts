"use client";
import useSWR from "swr";
import { useMemo } from "react";
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
  // One full collection per scope; consumers choose their visible subset.
  const url = "/api/repos?show_hidden=true";
  const { data, error, isLoading, mutate } = useSWR<Repo[], Error>(
    options.enabled === false ? null : [url, teamId],
    ([url, teamId]: [string, string | null]) => fetcher(url, teamId)
  );
  const repos = useMemo(
    () => (data ?? []).filter((repo) => options.showHidden || !repo.is_hidden),
    [data, options.showHidden]
  );
  return { repos, isLoading, error, mutate };
}
