import { coerceGraph, getStartConfig } from "@/lib/flows/graph";
import {
  getJobRunSourceKind,
  isCancelableJobRun,
  isRepairableJobRun,
  isRequeueableJobRun,
} from "@/lib/job-runs";
import type { FlowNodeRun, FlowRunRecord, JobRun } from "@/lib/types";

/**
 * Gather the de-duplicated ids the run list needs to join against. A run's
 * flow version can come from the column or from metadata, so both are
 * considered.
 */
export function collectFlowRunLookupIds(
  runs: readonly { id: string; flow_version_id: unknown; metadata: unknown }[]
) {
  const flowVersionIds = new Set<string>();
  const repoIds = new Set<string>();

  for (const run of runs) {
    const columnVersionId =
      typeof run.flow_version_id === "string" ? run.flow_version_id : null;
    const metadataVersionId = metadataString(run.metadata, "flow_version_id");
    if (columnVersionId) flowVersionIds.add(columnVersionId);
    if (metadataVersionId) flowVersionIds.add(metadataVersionId);

    const repoId = metadataString(run.metadata, "repo_id");
    if (repoId) repoIds.add(repoId);
  }

  return {
    jobRunIds: runs.map((run) => run.id),
    flowVersionIds: Array.from(flowVersionIds),
    repoIds: Array.from(repoIds),
  };
}

export function readFlowVersionSourceType(graph: unknown): string | null {
  return getStartConfig(coerceGraph(graph))?.event ?? null;
}

export type LatestDispatchEvent = {
  id: string;
  event_kind: "enqueue" | "start" | "control";
  outcome:
    | "queued"
    | "suppressed"
    | "started"
    | "deferred"
    | "start_failed"
    | "completed"
    | "failed"
    | "cancel_requested"
    | "cancelled"
    | "cancel_failed"
    | "reconciled";
  reason: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

/**
 * Newest dispatch event per job run. Rows arrive newest-first, so the first one
 * seen for a job run wins and later ones are ignored.
 */
export function indexLatestDispatchEvents(
  events: readonly (LatestDispatchEvent & { job_run_id: string | null })[]
): Map<string, LatestDispatchEvent> {
  const latestDispatchByJobId = new Map<string, LatestDispatchEvent>();

  for (const event of events) {
    if (!event.job_run_id || latestDispatchByJobId.has(event.job_run_id)) {
      continue;
    }
    latestDispatchByJobId.set(event.job_run_id, {
      id: event.id,
      event_kind: event.event_kind,
      outcome: event.outcome,
      reason: event.reason,
      metadata: event.metadata ?? null,
      created_at: event.created_at,
    });
  }

  return latestDispatchByJobId;
}

/** Read a string field out of a job run's free-form metadata blob. */
export function metadataString(metadata: unknown, key: string): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const value = Reflect.get(metadata, key);
  return typeof value === "string" ? value : null;
}

export type FlowRunIndexes = {
  reposById: Map<string, { id: string; full_name: string | null }>;
  flowSourceTypeByVersionId: Map<string, string | null>;
  latestDispatchByJobId: Map<
    string,
    NonNullable<FlowRunRecord["latest_dispatch_event"]>
  >;
  nodeRunsByJobId: Map<string, FlowNodeRun[]>;
  activeWaitCountByJobId: Map<string, number>;
};

/** The joined repo row wins; metadata is the fallback for runs that outlive it. */
export function resolveFlowRunRepo(
  metadata: unknown,
  reposById: FlowRunIndexes["reposById"]
) {
  const repoId = metadataString(metadata, "repo_id");
  const repo = repoId ? reposById.get(repoId) : null;

  return {
    id: repo?.id || repoId,
    full_name: repo?.full_name || metadataString(metadata, "repo_full_name"),
  };
}

export function resolveFlowRunSourceType(
  metadata: unknown,
  flowVersionId: string | null,
  flowSourceTypeByVersionId: FlowRunIndexes["flowSourceTypeByVersionId"]
): string {
  const explicit = metadataString(metadata, "source_type");
  if (explicit !== null) return explicit;
  if (!flowVersionId) return "flow";
  return flowSourceTypeByVersionId.get(flowVersionId) ?? "flow";
}

// `cost_usd` is optional here because some callers select a narrower column
// set; the returned record always fills it in explicitly.
export function toFlowRunRecord<
  TRun extends Omit<JobRun, "cost_usd"> & { cost_usd?: number | null },
>(run: TRun, indexes: FlowRunIndexes): FlowRunRecord {
  const flowVersionId =
    typeof run.flow_version_id === "string"
      ? run.flow_version_id
      : metadataString(run.metadata, "flow_version_id");

  return {
    ...run,
    source_kind: getJobRunSourceKind(run),
    source_type: resolveFlowRunSourceType(
      run.metadata,
      flowVersionId,
      indexes.flowSourceTypeByVersionId
    ),
    repo: resolveFlowRunRepo(run.metadata, indexes.reposById),
    agent: {
      id: null,
      name: null,
      slug: null,
    },
    cost_usd: run.cost_usd ?? null,
    latest_ai_call: null,
    repairable: isRepairableJobRun(run),
    requeueable: isRequeueableJobRun(run),
    cancelable: isCancelableJobRun(run),
    active_wait_count: indexes.activeWaitCountByJobId.get(run.id) ?? 0,
    latest_dispatch_event: indexes.latestDispatchByJobId.get(run.id) || null,
    node_runs: indexes.nodeRunsByJobId.get(run.id) || [],
  };
}
