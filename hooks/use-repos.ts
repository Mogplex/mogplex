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

export function useRepos() {
  const activeTeamId = useActiveTeamId();
  const { data, error, isLoading, mutate } = useSWR<Repo[], Error>(
    ["/api/repos", activeTeamId],
    ([url, teamId]: [string, string | null]) => fetcher(url, teamId)
  );
  return { repos: data ?? [], isLoading, error, mutate };
}
