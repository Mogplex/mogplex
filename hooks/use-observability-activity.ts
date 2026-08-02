"use client";

import useSWR from "swr";
import { useRealtimeRouteRefresh } from "@/hooks/use-realtime-route-refresh";
import { OBSERVABILITY_ACTIVITY_REALTIME_SPECS } from "@/lib/observability/realtime-specs";
import type { AiCall } from "@/lib/types";

export type ActivityFilters = {
  page: number;
  limit: number;
  sort: string;
  order: "asc" | "desc";
  surface?: string;
  status?: string;
  model?: string;
  repoId?: string;
  sandboxRecordId?: string;
  from?: string;
  to?: string;
  conversationId?: string;
  q?: string;
};

export type ActivityResponse = {
  calls: AiCall[];
  total: number;
  page: number;
  limit: number;
};

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}`);
  return res.json() as Promise<ActivityResponse>;
};

function buildActivityUrl(filters: ActivityFilters): string {
  const params = new URLSearchParams();
  params.set("page", String(filters.page));
  params.set("limit", String(filters.limit));
  params.set("sort", filters.sort);
  params.set("order", filters.order);
  if (filters.surface) params.set("surface", filters.surface);
  if (filters.status) params.set("status", filters.status);
  if (filters.model) params.set("model", filters.model);
  if (filters.repoId) params.set("repo_id", filters.repoId);
  if (filters.sandboxRecordId)
    params.set("sandbox_record_id", filters.sandboxRecordId);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.conversationId)
    params.set("conversation_id", filters.conversationId);
  if (filters.q) params.set("q", filters.q);
  return `/api/observability/calls?${params.toString()}`;
}

export function useObservabilityActivity(filters: ActivityFilters) {
  const url = buildActivityUrl(filters);
  const { data, error, isLoading, mutate } = useSWR<ActivityResponse>(
    url,
    fetcher
  );

  useRealtimeRouteRefresh({
    channelName: `observability-activity:${url}`,
    specs: OBSERVABILITY_ACTIVITY_REALTIME_SPECS,
    onInvalidate: () => void mutate(),
  });

  return {
    data,
    isLoading,
    error,
    refresh: mutate,
  };
}
