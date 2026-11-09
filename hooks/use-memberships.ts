"use client";
import useSWR from "swr";
import { fetchJsonObject } from "@/lib/client-fetch";
import type { MembershipsResponse } from "@/app/api/memberships/route";

const EMPTY: MembershipsResponse = {
  personal: { slug: null, name: null, avatarUrl: null },
  teams: [],
};

const fetcher = (url: string) =>
  fetchJsonObject<MembershipsResponse>(url, "Failed to load memberships");

/** Pass `enabled: false` while signed out so no unauthenticated request is made. */
export function useMemberships({ enabled = true }: { enabled?: boolean } = {}) {
  const { data, error, isLoading, mutate } = useSWR<MembershipsResponse>(
    enabled ? "/api/memberships" : null,
    fetcher
  );

  return {
    memberships: data ?? EMPTY,
    isLoading,
    error,
    mutate,
  };
}
