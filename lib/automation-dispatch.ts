import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { fetchAllRows } from "@/lib/supabase/fetch-all-rows";
import {
  loadUserAutomationScope,
  resolveFlowVersionAttribution,
} from "@/lib/job-run-service";

export const DISPATCH_EVENT_KINDS = ["enqueue", "start", "control"] as const;
export const DISPATCH_EVENT_OUTCOMES = [
  "queued",
  "suppressed",
  "started",
  "deferred",
  "start_failed",
  "completed",
  "failed",
  "cancel_requested",
  "cancelled",
  "cancel_failed",
  "reconciled",
] as const;

export type AutomationDispatchEventKind = (typeof DISPATCH_EVENT_KINDS)[number];
export type AutomationDispatchEventOutcome =
  (typeof DISPATCH_EVENT_OUTCOMES)[number];
export type AutomationDispatchSourceKind =
  | "assignment"
  | "trigger"
  | "flow"
  | "manual_retry";

type AutomationDispatchEventRow = {
  id: string;
  user_id: string;
  job_run_id: string | null;
  assignment_id: string | null;
  trigger_id: string | null;
  flow_id: string | null;
  flow_version_id: string | null;
  repo_id: string | null;
  installation_id: number | null;
  source_kind: AutomationDispatchSourceKind;
  source_type: string;
  event_kind: AutomationDispatchEventKind;
  outcome: AutomationDispatchEventOutcome;
  reason: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export function getAutomationDispatchSourceKind(
  row: Pick<AutomationDispatchEventRow, "source_kind" | "flow_id">
): AutomationDispatchSourceKind {
  if (row.flow_id && row.source_kind === "trigger") {
    return "flow";
  }

  return row.source_kind;
}

export async function enqueueAutomationJobRun(input: {
  userId: string;
  assignmentId?: string | null;
  triggerId?: string | null;
  retryOfJobRunId?: string | null;
  flowId?: string | null;
  flowVersionId?: string | null;
  repoId?: string | null;
  installationId?: number | null;
  sourceKind: AutomationDispatchSourceKind;
  sourceType: string;
  idempotencyKey: string;
  metadata?: Record<string, unknown> | null;
  duplicateSensitive?: boolean;
  maxActivePerRepo?: number;
  maxActivePerInstallation?: number;
}) {
  const { data, error } = await supabaseAdmin.rpc(
    "enqueue_automation_job_run",
    {
      p_user_id: input.userId,
      p_assignment_id: input.assignmentId ?? null,
      p_trigger_id: input.triggerId ?? null,
      p_retry_of_job_run_id: input.retryOfJobRunId ?? null,
      p_flow_id: input.flowId ?? null,
      p_flow_version_id: input.flowVersionId ?? null,
      p_repo_id: input.repoId ?? null,
      p_installation_id: input.installationId ?? null,
      p_source_kind: input.sourceKind,
      p_source_type: input.sourceType,
      p_idempotency_key: input.idempotencyKey,
      p_metadata: input.metadata ?? {},
      p_duplicate_sensitive: input.duplicateSensitive ?? false,
      p_max_active_per_repo: input.maxActivePerRepo ?? 25,
      p_max_active_per_installation: input.maxActivePerInstallation ?? 100,
    }
  );

  if (error) {
    throw new Error(`Failed to enqueue automation job: ${error.message}`);
  }

  const row = (Array.isArray(data) ? data[0] : data) as {
    job_run_id?: string | null;
    outcome?: string | null;
    reason?: string | null;
  } | null;

  return {
    jobRunId: row?.job_run_id ?? null,
    outcome: (row?.outcome ?? "suppressed") as "queued" | "suppressed",
    reason: row?.reason ?? null,
  };
}

export async function logAutomationDispatchEvent(input: {
  userId: string;
  jobRunId?: string | null;
  assignmentId?: string | null;
  triggerId?: string | null;
  flowId?: string | null;
  flowVersionId?: string | null;
  repoId?: string | null;
  installationId?: number | null;
  sourceKind: AutomationDispatchSourceKind;
  sourceType: string;
  eventKind: AutomationDispatchEventKind;
  outcome: AutomationDispatchEventOutcome;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
  adminClient?: SupabaseClient;
}) {
  const adminClient = input.adminClient ?? supabaseAdmin;
  const { error } = await adminClient
    .from("automation_dispatch_events")
    .insert({
      user_id: input.userId,
      job_run_id: input.jobRunId ?? null,
      assignment_id: input.assignmentId ?? null,
      trigger_id: input.triggerId ?? null,
      flow_id: input.flowId ?? null,
      flow_version_id: input.flowVersionId ?? null,
      repo_id: input.repoId ?? null,
      installation_id: input.installationId ?? null,
      source_kind: input.sourceKind,
      source_type: input.sourceType,
      event_kind: input.eventKind,
      outcome: input.outcome,
      reason: input.reason ?? null,
      metadata: input.metadata ?? {},
    });

  if (error) {
    throw new Error(
      `Failed to log automation dispatch event: ${error.message}`
    );
  }
}

/**
 * Backstop for the marker-based self-mention guard: count how many `mention`
 * job runs were actually queued for a given PR/issue in the recent window.
 * The marker guard (lib/github-automation-marker) handles the deterministic
 * case; this bounds blast radius when a marker is missing — e.g. a third-party
 * agent re-posts our text, or GitHub strips the trailing HTML comment.
 *
 * Counts only `enqueue`/`queued` events (written by the enqueue RPC), so the
 * loop-breaker's own `suppressed` events do not inflate the count.
 */
export async function countRecentMentionEnqueues(input: {
  repoId: string;
  issueNumber: number;
  sinceMinutes: number;
  now?: number;
}): Promise<number> {
  const now = input.now ?? Date.now();
  const cutoff = new Date(now - input.sinceMinutes * 60 * 1000).toISOString();

  const { count, error } = await supabaseAdmin
    .from("automation_dispatch_events")
    .select("id", { count: "exact", head: true })
    .eq("repo_id", input.repoId)
    .eq("source_type", "mention")
    .eq("event_kind", "enqueue")
    .eq("outcome", "queued")
    .gte("created_at", cutoff)
    .filter("metadata->>issue_number", "eq", String(input.issueNumber));

  if (error) {
    throw new Error(
      `Failed to count recent mention enqueues: ${error.message}`
    );
  }

  return count ?? 0;
}

export function summarizeEntityDispatchEvents<
  T extends {
    outcome: AutomationDispatchEventOutcome;
    reason: string | null;
    created_at: string;
  },
>(events: T[], now = Date.now()) {
  const cutoff = now - 24 * 60 * 60 * 1000;
  const inWindow = events.filter(
    (event) => new Date(event.created_at).getTime() >= cutoff
  );
  const latestWithReason = [...events]
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )
    .find((event) => Boolean(event.reason));

  return {
    suppressed_24h: inWindow.filter((event) => event.outcome === "suppressed")
      .length,
    deferred_24h: inWindow.filter((event) => event.outcome === "deferred")
      .length,
    start_failed_24h: inWindow.filter(
      (event) => event.outcome === "start_failed"
    ).length,
    last_pressure_reason: latestWithReason?.reason ?? null,
    last_pressure_at: latestWithReason?.created_at ?? null,
  };
}

function collectEventFlowVersionIds(
  events: readonly AutomationDispatchEventRow[]
): string[] {
  return Array.from(
    new Set(
      events.flatMap((event) =>
        [
          event.flow_version_id,
          typeof event.metadata?.flow_version_id === "string"
            ? event.metadata.flow_version_id
            : null,
        ].filter(
          (value): value is string =>
            typeof value === "string" && value.length > 0
        )
      )
    )
  );
}

export async function loadUserAutomationDispatchEvents(input: {
  userId: string;
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
}) {
  // Minimal structural view of the query builder: the full supabase-js
  // builder generics make a shared filter helper blow past TS's instantiation
  // depth, and only these methods are used here.
  type DispatchEventQuery = {
    eq: (column: string, value: string) => DispatchEventQuery;
    gte: (column: string, value: string) => DispatchEventQuery;
    lte: (column: string, value: string) => DispatchEventQuery;
    order: (column: string, opts: { ascending: boolean }) => DispatchEventQuery;
    range: (
      from: number,
      to: number
    ) => PromiseLike<{
      data: unknown[] | null;
      count: number | null;
      error: { message: string } | null;
    }>;
  };

  const applySqlFilters = (query: DispatchEventQuery) => {
    let next = query.eq("user_id", input.userId);
    if (input.outcome) next = next.eq("outcome", input.outcome);
    if (input.reason) next = next.eq("reason", input.reason);
    if (input.repoId) next = next.eq("repo_id", input.repoId);
    if (input.sourceType) next = next.eq("source_type", input.sourceType);
    if (input.from) next = next.gte("created_at", input.from);
    if (input.to) next = next.lte("created_at", input.to);
    return next;
  };

  const start = (input.page - 1) * input.limit;
  const end = start + input.limit;

  // sourceKind/agentId derive from metadata and entity attribution, so they
  // can only be applied in memory. Without them every predicate is SQL, and
  // the database can page and count exactly — no scan, no result cap.
  const needsInMemoryFilters = Boolean(input.sourceKind || input.agentId);

  if (!needsInMemoryFilters) {
    const { data, count, error } = await applySqlFilters(
      supabaseAdmin
        .from("automation_dispatch_events")
        .select("*", { count: "exact" }) as unknown as DispatchEventQuery
    )
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(start, end - 1);

    if (error) {
      throw new Error(
        `Failed to load automation dispatch events: ${error.message}`
      );
    }

    const pageEvents = (data || []) as AutomationDispatchEventRow[];
    const scope = await loadUserAutomationScope(input.userId, {
      flowVersionIds: collectEventFlowVersionIds(pageEvents),
    });
    return { scope, events: pageEvents, total: count ?? pageEvents.length };
  }

  // In-memory filters need the full SQL-matched set: a fixed cap here makes
  // `total` a lie past the cap and can return empty pages while older
  // matches exist, so scan to exhaustion instead. The SQL predicates (user,
  // outcome, repo, source type, date range) keep the scanned set far smaller
  // than the table.
  const events = (await fetchAllRows(
    () =>
      applySqlFilters(
        supabaseAdmin
          .from("automation_dispatch_events")
          .select("*") as unknown as DispatchEventQuery
      ),
    "created_at",
    "automation dispatch events"
  )) as AutomationDispatchEventRow[];
  // fetchAllRows pages oldest-first for scan stability; consumers expect
  // newest-first.
  events.reverse();
  const scope = await loadUserAutomationScope(input.userId, {
    flowVersionIds: collectEventFlowVersionIds(events),
  });

  const filtered = events.filter((event) => {
    const normalizedSourceKind = getAutomationDispatchSourceKind(event);

    if (input.sourceKind && normalizedSourceKind !== input.sourceKind) {
      return false;
    }

    if (!input.agentId) {
      return true;
    }

    if (event.assignment_id) {
      return (
        scope.assignmentsById.get(event.assignment_id)?.agent_id ===
        input.agentId
      );
    }

    if (event.flow_id) {
      return (
        resolveFlowVersionAttribution(scope, {
          flowId: event.flow_id,
          flowVersionId: event.flow_version_id,
          metadata: event.metadata,
        })?.agentIds.includes(input.agentId) === true
      );
    }

    if (event.trigger_id) {
      return (
        scope.triggersById.get(event.trigger_id)?.agent_id === input.agentId
      );
    }

    return false;
  });

  return {
    scope,
    events: filtered.slice(start, end),
    total: filtered.length,
  };
}
