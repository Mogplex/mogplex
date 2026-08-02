import type {
  AutomationFailureBreakdown,
  AutomationFailureFilterOptions,
  AutomationFailureRecord,
} from "@/lib/automation-failure-observability";
import useSWR from "swr";
import { useRealtimeRouteRefresh } from "@/hooks/use-realtime-route-refresh";
import {
  OBSERVABILITY_JOBS_REALTIME_SPECS,
  OBSERVABILITY_STATS_REALTIME_SPECS,
  USER_AI_CALLS_REALTIME_SPEC,
  USER_AI_CALL_EVENTS_REALTIME_SPEC,
  USER_AUTOMATION_DISPATCH_EVENTS_REALTIME_SPEC,
} from "@/lib/observability/realtime-specs";
import type {
  AiCall,
  AiCallEvent,
  AutomationDispatchEvent,
  ObservabilityJob,
} from "@/lib/types";

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}`);
  return res.json();
};

export type ObservabilityStats = {
  summary: {
    total_calls: number;
    total_tokens: number;
    total_cost: number;
    cost_today: number;
    // null when the upstream count query fails — distinct from "0 pending".
    reconciliation_pending: number | null;
    avg_duration_ms: number;
    success_rate: number;
    calls_today: number;
    tokens_today: number;
    sandbox_time_ms: number;
    sandbox_active: number;
    sandbox_total: number;
    job_runs_total: number;
    job_runs_running: number;
    job_runs_pending: number;
    job_runs_stale_pending: number;
    job_runs_failed_in_range: number;
    job_runs_repaired_in_range: number;
    job_runs_concluded_in_range: number;
    // null when no runs reached a terminal verdict in the window (UI shows "—").
    job_runs_success_rate_in_range: number | null;
    suppressed_in_range: number;
    deferred_in_range: number;
    start_failed_in_range: number;
    limit_allowed_in_range: number;
    limit_denied_in_range: number;
    oldest_pending_age_ms: number;
  };
  by_model: { model: string; count: number; tokens: number }[];
  by_type: { type: string; count: number }[];
};

export type CallsFilters = {
  page: number;
  limit: number;
  sort: string;
  order: "asc" | "desc";
  liveOnly?: boolean;
  type?: string;
  model?: string;
  status?: string;
  repoId?: string;
  sandboxRecordId?: string;
  from?: string;
  to?: string;
  conversationId?: string;
  agentId?: string;
};

export type CallsResponse = {
  calls: AiCall[];
  total: number;
  page: number;
  limit: number;
};

export type CallEventsResponse = {
  events: AiCallEvent[];
};

export type JobsFilters = {
  page: number;
  limit: number;
  sort: string;
  order: "asc" | "desc";
  status?: string;
  sourceKind?: string;
  sourceType?: string;
  repoId?: string;
  agentId?: string;
  onlyRepairable?: boolean;
  onlyRetried?: boolean;
  from?: string;
  to?: string;
};

export type JobsResponse = {
  jobs: ObservabilityJob[];
  total: number;
  page: number;
  limit: number;
};

export type AutomationEventsFilters = {
  page: number;
  limit: number;
  outcome?: string;
  reason?: string;
  repoId?: string;
  sourceKind?: string;
  sourceType?: string;
  agentId?: string;
  from?: string;
  to?: string;
};

export type AutomationEventsResponse = {
  events: AutomationDispatchEvent[];
  total: number;
  page: number;
  limit: number;
};

export type AutomationFailuresFilters = {
  page: number;
  limit: number;
  failureClass?: string;
  sourceType?: string;
  provider?: string;
  model?: string;
  from?: string;
  to?: string;
};

export type AutomationFailuresResponse = {
  summary: {
    failedTotal: number;
    successfulRecoveries: number;
    retriedFailures: number;
    timeoutFailures: number;
    authenticationFailures: number;
    configurationFailures: number;
    providerFailures: number;
    dependencyFailures: number;
  };
  breakdowns: {
    byFailureClass: AutomationFailureBreakdown[];
    bySourceType: AutomationFailureBreakdown[];
    byProvider: AutomationFailureBreakdown[];
    byModel: AutomationFailureBreakdown[];
    byTimeoutBucket: AutomationFailureBreakdown[];
  };
  filter_options: AutomationFailureFilterOptions;
  records: AutomationFailureRecord[];
  total: number;
  page: number;
  limit: number;
};

function buildCallsUrl(filters: CallsFilters): string {
  const params = new URLSearchParams();
  params.set("page", String(filters.page));
  params.set("limit", String(filters.limit));
  params.set("sort", filters.sort);
  params.set("order", filters.order);
  if (filters.liveOnly) params.set("live_only", "true");
  if (filters.type) params.set("type", filters.type);
  if (filters.model) params.set("model", filters.model);
  if (filters.status) params.set("status", filters.status);
  if (filters.repoId) params.set("repo_id", filters.repoId);
  if (filters.sandboxRecordId)
    params.set("sandbox_record_id", filters.sandboxRecordId);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.conversationId)
    params.set("conversation_id", filters.conversationId);
  if (filters.agentId) params.set("agent_id", filters.agentId);
  return `/api/observability/calls?${params.toString()}`;
}

function buildJobsUrl(filters: JobsFilters): string {
  const params = new URLSearchParams();
  params.set("page", String(filters.page));
  params.set("limit", String(filters.limit));
  params.set("sort", filters.sort);
  params.set("order", filters.order);
  if (filters.status) params.set("status", filters.status);
  if (filters.sourceKind) params.set("source_kind", filters.sourceKind);
  if (filters.sourceType) params.set("source_type", filters.sourceType);
  if (filters.repoId) params.set("repo_id", filters.repoId);
  if (filters.agentId) params.set("agent_id", filters.agentId);
  if (filters.onlyRepairable) params.set("only_repairable", "true");
  if (filters.onlyRetried) params.set("only_retried", "true");
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  return `/api/observability/jobs?${params.toString()}`;
}

function buildCallEventsUrl(aiCallId: string) {
  const params = new URLSearchParams();
  params.set("ai_call_id", aiCallId);
  return `/api/observability/call-events?${params.toString()}`;
}

function buildAutomationEventsUrl(filters: AutomationEventsFilters): string {
  const params = new URLSearchParams();
  params.set("page", String(filters.page));
  params.set("limit", String(filters.limit));
  if (filters.outcome) params.set("outcome", filters.outcome);
  if (filters.reason) params.set("reason", filters.reason);
  if (filters.repoId) params.set("repo_id", filters.repoId);
  if (filters.sourceKind) params.set("source_kind", filters.sourceKind);
  if (filters.sourceType) params.set("source_type", filters.sourceType);
  if (filters.agentId) params.set("agent_id", filters.agentId);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  return `/api/observability/automation-events?${params.toString()}`;
}

function buildAutomationFailuresUrl(
  filters: AutomationFailuresFilters
): string {
  const params = new URLSearchParams();
  params.set("page", String(filters.page));
  params.set("limit", String(filters.limit));
  if (filters.failureClass) {
    params.set("failure_class", filters.failureClass);
  }
  if (filters.sourceType) params.set("source_type", filters.sourceType);
  if (filters.provider) params.set("provider", filters.provider);
  if (filters.model) params.set("model", filters.model);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  return `/api/observability/automation-failures?${params.toString()}`;
}

export type ObservabilityStatsFilters = {
  from?: string;
  to?: string;
};

function buildStatsUrl(filters?: ObservabilityStatsFilters): string {
  const params = new URLSearchParams();
  if (filters?.from) params.set("from", filters.from);
  if (filters?.to) params.set("to", filters.to);
  const query = params.toString();
  return query
    ? `/api/observability/stats?${query}`
    : "/api/observability/stats";
}

export function useObservabilityStats(filters?: ObservabilityStatsFilters) {
  const url = buildStatsUrl(filters);
  const { data, error, mutate } = useSWR<ObservabilityStats>(url, fetcher);
  useRealtimeRouteRefresh({
    channelName: "observability-stats",
    specs: OBSERVABILITY_STATS_REALTIME_SPECS,
    onInvalidate: mutate,
  });
  return { stats: data, error, refresh: mutate };
}

export function useObservabilityCalls(filters: CallsFilters | null) {
  const url = filters ? buildCallsUrl(filters) : null;
  const { data, error, mutate, isLoading } = useSWR<CallsResponse>(
    url,
    fetcher
  );
  useRealtimeRouteRefresh({
    channelName: `observability-calls:${url ?? "disabled"}`,
    specs: [USER_AI_CALLS_REALTIME_SPEC],
    onInvalidate: mutate,
    enabled: Boolean(url),
  });
  return { data, error, refresh: mutate, isLoading };
}

export function useConversationRuns(
  conversationId: string | null,
  limit = 100
) {
  return useLiveInteractiveCalls({ limit, conversationId });
}

export function useAiCallEvents(aiCallId: string | null) {
  const url = aiCallId ? buildCallEventsUrl(aiCallId) : null;
  const { data, error, mutate, isLoading } = useSWR<CallEventsResponse>(
    url,
    fetcher
  );
  useRealtimeRouteRefresh({
    channelName: `ai-call-events:${aiCallId ?? "disabled"}`,
    specs: [USER_AI_CALL_EVENTS_REALTIME_SPEC, USER_AI_CALLS_REALTIME_SPEC],
    onInvalidate: mutate,
    enabled: Boolean(url),
  });
  return {
    events: data?.events || [],
    error,
    refresh: mutate,
    isLoading,
  };
}

export function useObservabilityJobs(filters: JobsFilters | null) {
  const url = filters ? buildJobsUrl(filters) : null;
  const { data, error, mutate, isLoading } = useSWR<JobsResponse>(url, fetcher);
  useRealtimeRouteRefresh({
    channelName: `observability-jobs:${url ?? "disabled"}`,
    specs: OBSERVABILITY_JOBS_REALTIME_SPECS,
    onInvalidate: mutate,
    enabled: Boolean(url),
  });
  return { data, error, refresh: mutate, isLoading };
}

export function useObservabilityAutomationEvents(
  filters: AutomationEventsFilters | null
) {
  const url = filters ? buildAutomationEventsUrl(filters) : null;
  const { data, error, mutate, isLoading } = useSWR<AutomationEventsResponse>(
    url,
    fetcher
  );
  useRealtimeRouteRefresh({
    channelName: `observability-automation-events:${url ?? "disabled"}`,
    specs: [USER_AUTOMATION_DISPATCH_EVENTS_REALTIME_SPEC],
    onInvalidate: mutate,
    enabled: Boolean(url),
  });
  return { data, error, refresh: mutate, isLoading };
}

export function useObservabilityAutomationFailures(
  filters: AutomationFailuresFilters | null
) {
  const url = filters ? buildAutomationFailuresUrl(filters) : null;
  const { data, error, mutate, isLoading } = useSWR<AutomationFailuresResponse>(
    url,
    fetcher
  );
  useRealtimeRouteRefresh({
    channelName: `observability-automation-failures:${url ?? "disabled"}`,
    specs: [USER_AUTOMATION_DISPATCH_EVENTS_REALTIME_SPEC],
    onInvalidate: mutate,
    enabled: Boolean(url),
  });
  return { data, error, refresh: mutate, isLoading };
}

/** Convenience hook: fetch recent calls for the compact pane */
export function useRecentCalls(limit = 20) {
  const { data, error, isLoading, mutate } = useSWR<CallsResponse>(
    `/api/observability/calls?page=1&limit=${limit}&sort=started_at&order=desc`,
    fetcher
  );
  useRealtimeRouteRefresh({
    channelName: `recent-calls:${limit}`,
    specs: [USER_AI_CALLS_REALTIME_SPEC],
    onInvalidate: mutate,
  });
  return {
    calls: data?.calls || [],
    total: data?.total || 0,
    error,
    isLoading,
  };
}

export function useLiveInteractiveCalls(options?: {
  limit?: number;
  conversationId?: string | null;
  repoId?: string;
  sandboxRecordId?: string;
}) {
  const limit = options?.limit ?? 100;
  const { data, error, refresh, isLoading } = useObservabilityCalls({
    page: 1,
    limit,
    sort: "started_at",
    order: "desc",
    liveOnly: true,
    conversationId: options?.conversationId ?? undefined,
    repoId: options?.repoId,
    sandboxRecordId: options?.sandboxRecordId,
  });
  return {
    calls: data?.calls || [],
    total: data?.total || 0,
    error,
    refresh,
    isLoading,
  };
}

export function useRecentJobRuns(limit = 20) {
  const { data, error, isLoading, mutate } = useSWR<JobsResponse>(
    `/api/observability/jobs?page=1&limit=${limit}&sort=created_at&order=desc`,
    fetcher
  );
  useRealtimeRouteRefresh({
    channelName: `recent-job-runs:${limit}`,
    specs: OBSERVABILITY_JOBS_REALTIME_SPECS,
    onInvalidate: mutate,
  });
  return { jobs: data?.jobs || [], total: data?.total || 0, error, isLoading };
}

export function useRecentAutomationEvents(limit = 20) {
  const { data, error, isLoading, mutate } = useSWR<AutomationEventsResponse>(
    `/api/observability/automation-events?page=1&limit=${limit}`,
    fetcher
  );
  useRealtimeRouteRefresh({
    channelName: `recent-automation-events:${limit}`,
    specs: [USER_AUTOMATION_DISPATCH_EVENTS_REALTIME_SPEC],
    onInvalidate: mutate,
  });
  return {
    events: data?.events || [],
    total: data?.total || 0,
    error,
    isLoading,
  };
}

// Keep backward compat export name
export function useObservability() {
  const { stats, error, refresh } = useObservabilityStats();
  return { stats: stats?.summary, error, refresh };
}

export function useRealtimeJobs() {
  return useLiveInteractiveCalls().calls;
}

export type ToolCallEntry = {
  id: string;
  name: string;
  input_preview: string | null;
  output_preview: string | null;
  input?: unknown;
  output?: unknown;
  model: string;
  type: string;
  started_at: string;
};

export function useRealtimeToolCalls(): ToolCallEntry[] {
  const { data, mutate } = useSWR<ToolCallEntry[]>(
    "/api/observability/tool-calls",
    fetcher
  );
  useRealtimeRouteRefresh({
    channelName: "realtime-tool-calls",
    specs: [USER_AI_CALLS_REALTIME_SPEC],
    onInvalidate: mutate,
  });
  return data || [];
}
