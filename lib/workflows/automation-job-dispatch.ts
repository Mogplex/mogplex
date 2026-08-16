/**
 * Dispatch and event logging for the automation job workflow.
 * Extracted from automation-job-workflow.ts for modularity.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { logAutomationDispatchEvent } from "@/lib/automation-dispatch";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { coerceGraph, getStartConfig } from "@/lib/flows/graph";
import type { JobRunStartSource } from "@/lib/job-runs";
import type {
  DispatchLogContext,
  StartDispatchContext,
  ReleasedAutomationScope,
  JobContext,
  ResolvedFlowDefinition,
} from "@/lib/workflows/automation-job-types";

export function buildDispatchLogContext(input: {
  releasedScope: ReleasedAutomationScope;
  context: JobContext;
  resolvedFlow?: ResolvedFlowDefinition | null;
}): DispatchLogContext {
  return {
    userId: input.context.repo.user_id,
    assignmentId:
      input.releasedScope.sourceKind === "assignment"
        ? input.releasedScope.sourceId
        : null,
    triggerId:
      input.releasedScope.sourceKind === "trigger"
        ? input.releasedScope.sourceId
        : null,
    flowId:
      input.resolvedFlow?.flowId ??
      (input.releasedScope.sourceKind === "flow"
        ? input.releasedScope.sourceId
        : null) ??
      (typeof input.context.metadata.flow_id === "string"
        ? input.context.metadata.flow_id
        : null),
    flowVersionId:
      input.resolvedFlow?.flowVersionId ??
      (typeof input.context.metadata.flow_version_id === "string"
        ? input.context.metadata.flow_version_id
        : null),
    repoId: input.releasedScope.repoId ?? input.context.repo.id,
    installationId:
      input.releasedScope.installationId ??
      input.context.repo.github_installation_id ??
      null,
    sourceKind: input.releasedScope.sourceKind,
    sourceType: input.releasedScope.sourceType,
  };
}

export async function recordStartDispatchEvent(input: {
  context: StartDispatchContext | null;
  jobRunId: string;
  outcome: "started" | "deferred" | "start_failed";
  reason?: string | null;
  source: JobRunStartSource;
  metadata?: Record<string, unknown> | null;
  adminClient?: SupabaseClient;
}) {
  if (!input.context?.userId) return;

  try {
    await logAutomationDispatchEvent({
      userId: input.context.userId,
      jobRunId: input.jobRunId,
      assignmentId: input.context.assignmentId,
      triggerId: input.context.triggerId,
      flowId: input.context.flowId,
      flowVersionId: input.context.flowVersionId,
      repoId: input.context.repoId,
      installationId: input.context.installationId,
      sourceKind: input.context.sourceKind,
      sourceType: input.context.sourceType,
      eventKind: "start",
      outcome: input.outcome,
      reason: input.reason ?? null,
      metadata: {
        flow_id: input.context.flowId,
        flow_version_id: input.context.flowVersionId,
        start_source: input.source,
        ...input.metadata,
      },
      adminClient: input.adminClient,
    });
  } catch (error) {
    console.error("[automation-job] failed to log start dispatch event", {
      jobRunId: input.jobRunId,
      outcome: input.outcome,
      reason: input.reason,
      error:
        error instanceof Error ? error.message : "Unknown dispatch event error",
    });
  }
}

export async function recordControlDispatchEvent(input: {
  context: DispatchLogContext | null;
  jobRunId: string;
  outcome: "completed" | "failed" | "cancelled";
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
}) {
  if (!input.context?.userId) return;

  try {
    await logAutomationDispatchEvent({
      userId: input.context.userId,
      jobRunId: input.jobRunId,
      assignmentId: input.context.assignmentId,
      triggerId: input.context.triggerId,
      flowId: input.context.flowId,
      flowVersionId: input.context.flowVersionId,
      repoId: input.context.repoId,
      installationId: input.context.installationId,
      sourceKind: input.context.sourceKind,
      sourceType: input.context.sourceType,
      eventKind: "control",
      outcome: input.outcome,
      reason: input.reason ?? null,
      metadata: input.metadata ?? {},
    });
  } catch (error) {
    console.error("[automation-job] failed to log control dispatch event", {
      jobRunId: input.jobRunId,
      outcome: input.outcome,
      reason: input.reason,
      error:
        error instanceof Error ? error.message : "Unknown dispatch event error",
    });
  }
}

async function loadFlowDefinitionForDispatch(
  flowVersionId: string,
  flowId: string | null | undefined,
  adminClient: SupabaseClient
) {
  const { data: version, error: versionError } = await adminClient
    .from("flow_versions")
    .select("*")
    .eq("id", flowVersionId)
    .maybeSingle();

  if (versionError) {
    throw new Error(`Failed to load flow version: ${versionError.message}`);
  }
  if (!version) return null;

  const graph = coerceGraph(version.graph);
  return {
    flowId: flowId || version.flow_id,
    graph,
  };
}

export async function loadStartDispatchContext(
  jobRunId: string,
  adminClient: SupabaseClient = supabaseAdmin
): Promise<StartDispatchContext | null> {
  const { data: job, error } = await adminClient
    .from("job_runs")
    .select(
      "id, assignment_id, trigger_id, flow_id, flow_version_id, retry_of_job_run_id, metadata"
    )
    .eq("id", jobRunId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load job dispatch context: ${error.message}`);
  }

  if (!job) return null;

  const metadata = (job.metadata ?? {}) as Record<string, unknown>;

  if (job.assignment_id) {
    const { data: assignment, error: assignmentError } = await adminClient
      .from("assignments")
      .select("id, repo_id, type, repos(user_id, github_installation_id)")
      .eq("id", job.assignment_id)
      .maybeSingle();

    if (assignmentError) {
      throw new Error(
        `Failed to load assignment dispatch context: ${assignmentError.message}`
      );
    }

    const repo = Array.isArray(assignment?.repos)
      ? assignment?.repos[0]
      : assignment?.repos;
    return {
      userId: repo?.user_id || "",
      assignmentId: assignment?.id ?? job.assignment_id,
      triggerId: null,
      flowId: null,
      flowVersionId: null,
      repoId:
        assignment?.repo_id ??
        (typeof metadata.repo_id === "string" ? metadata.repo_id : null),
      installationId:
        typeof repo?.github_installation_id === "number"
          ? repo.github_installation_id
          : typeof metadata.installation_id === "number"
            ? metadata.installation_id
            : null,
      sourceKind: job.retry_of_job_run_id ? "manual_retry" : "assignment",
      sourceType:
        assignment?.type ||
        (typeof metadata.source_type === "string"
          ? metadata.source_type
          : "assignment"),
    };
  }

  if (job.trigger_id) {
    const { data: trigger, error: triggerError } = await adminClient
      .from("triggers")
      .select("id, user_id, installation_id, event")
      .eq("id", job.trigger_id)
      .maybeSingle();

    if (triggerError) {
      throw new Error(
        `Failed to load trigger dispatch context: ${triggerError.message}`
      );
    }

    return {
      userId: trigger?.user_id || "",
      assignmentId: null,
      triggerId: trigger?.id ?? job.trigger_id,
      flowId:
        typeof job.flow_id === "string"
          ? job.flow_id
          : typeof metadata.flow_id === "string"
            ? metadata.flow_id
            : null,
      flowVersionId:
        typeof job.flow_version_id === "string"
          ? job.flow_version_id
          : typeof metadata.flow_version_id === "string"
            ? metadata.flow_version_id
            : null,
      repoId: typeof metadata.repo_id === "string" ? metadata.repo_id : null,
      installationId:
        typeof trigger?.installation_id === "number"
          ? trigger.installation_id
          : typeof metadata.installation_id === "number"
            ? metadata.installation_id
            : null,
      sourceKind: job.retry_of_job_run_id ? "manual_retry" : "trigger",
      sourceType:
        trigger?.event ||
        (typeof metadata.source_type === "string"
          ? metadata.source_type
          : "trigger"),
    };
  }

  if (job.flow_id || job.flow_version_id) {
    const flowId =
      typeof job.flow_id === "string"
        ? job.flow_id
        : typeof metadata.flow_id === "string"
          ? metadata.flow_id
          : null;
    const flowVersionId =
      typeof job.flow_version_id === "string"
        ? job.flow_version_id
        : typeof metadata.flow_version_id === "string"
          ? metadata.flow_version_id
          : null;

    const { data: flow, error: flowError } = flowId
      ? await adminClient
          .from("flows")
          .select("id, user_id, installation_id")
          .eq("id", flowId)
          .maybeSingle()
      : { data: null, error: null };

    if (flowError) {
      throw new Error(
        `Failed to load flow dispatch context: ${flowError.message}`
      );
    }

    const startConfig = flowVersionId
      ? await loadFlowDefinitionForDispatch(flowVersionId, flowId, adminClient)
      : null;
    const flowEvent = startConfig
      ? (getStartConfig(startConfig.graph)?.event ?? null)
      : null;

    return {
      userId: flow?.user_id || "",
      assignmentId: null,
      triggerId: null,
      flowId,
      flowVersionId,
      repoId: typeof metadata.repo_id === "string" ? metadata.repo_id : null,
      installationId:
        typeof metadata.installation_id === "number"
          ? metadata.installation_id
          : typeof flow?.installation_id === "number"
            ? flow.installation_id
            : null,
      sourceKind: job.retry_of_job_run_id ? "manual_retry" : "flow",
      sourceType:
        typeof metadata.source_type === "string"
          ? metadata.source_type
          : (flowEvent ?? "flow"),
    };
  }

  return null;
}
