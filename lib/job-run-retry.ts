import { enqueueAutomationJobRun } from "@/lib/automation-dispatch";
import {
  loadUserAutomationScope,
  resolveFlowVersionAttribution,
} from "@/lib/job-run-service";
import { coerceGraph, getStartConfig } from "@/lib/flows/graph";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { JobRunRow } from "@/lib/job-run-service";

export type JobRunRetryContext = {
  run: JobRunRow;
  userId: string;
  sourceType: string;
  assignmentId: string | null;
  triggerId: string | null;
  flowId: string | null;
  flowVersionId: string | null;
  repoId: string | null;
  installationId: number | null;
  metadata: Record<string, unknown> | null;
};

export const JOB_RUN_RETRY_VERSION_MODES = [
  "same_version",
  "latest_published",
] as const;

export type JobRunRetryVersionMode =
  (typeof JOB_RUN_RETRY_VERSION_MODES)[number];

export class JobRunRetryVersionError extends Error {
  readonly code = "LATEST_PUBLISHED_VERSION_UNAVAILABLE";

  constructor(
    message = "The flow does not have an owned published version to run"
  ) {
    super(message);
    this.name = "JobRunRetryVersionError";
  }
}

export function isJobRunRetryVersionError(
  error: unknown
): error is JobRunRetryVersionError {
  if (error instanceof JobRunRetryVersionError) return true;
  if (!error || typeof error !== "object") return false;

  const candidate = error as {
    code?: unknown;
    message?: unknown;
    name?: unknown;
  };
  return (
    candidate.name === "JobRunRetryVersionError" &&
    candidate.code === "LATEST_PUBLISHED_VERSION_UNAVAILABLE" &&
    typeof candidate.message === "string"
  );
}

export function isJobRunRetryVersionMode(
  value: unknown
): value is JobRunRetryVersionMode {
  return (
    typeof value === "string" &&
    JOB_RUN_RETRY_VERSION_MODES.includes(value as JobRunRetryVersionMode)
  );
}

export function getDefaultJobRunRetryVersionMode(
  retryContext: Pick<JobRunRetryContext, "flowId">
): JobRunRetryVersionMode {
  return retryContext.flowId ? "latest_published" : "same_version";
}

type PublishedFlowVersionRow = {
  installation_id: number;
  published_version_id: string | null;
  published_version:
    | { id: string; flow_id: string; graph: unknown }
    | Array<{ id: string; flow_id: string; graph: unknown }>
    | null;
};

export function isPublishedFlowVersionRetryCompatible(input: {
  graph: unknown;
  installationId: number;
  expectedInstallationId: number | null;
  expectedSourceType: string;
}) {
  const publishedSourceType =
    getStartConfig(coerceGraph(input.graph))?.event ?? null;

  return (
    (input.expectedInstallationId === null ||
      input.installationId === input.expectedInstallationId) &&
    publishedSourceType === input.expectedSourceType
  );
}

async function loadOwnedPublishedFlowVersionId(input: {
  userId: string;
  flowId: string;
  expectedInstallationId: number | null;
  expectedSourceType: string;
}) {
  const { data, error } = await supabaseAdmin
    .from("flows")
    .select(
      "installation_id, published_version_id, published_version:flow_versions!flows_published_version_id_fkey(id, flow_id, graph)"
    )
    .eq("id", input.flowId)
    .eq("user_id", input.userId)
    .maybeSingle<PublishedFlowVersionRow>();

  if (error) {
    throw new Error(`Failed to load published flow version: ${error.message}`);
  }

  const publishedVersion = Array.isArray(data?.published_version)
    ? (data.published_version[0] ?? null)
    : (data?.published_version ?? null);

  if (
    !data?.published_version_id ||
    publishedVersion?.id !== data.published_version_id ||
    publishedVersion?.flow_id !== input.flowId ||
    !isPublishedFlowVersionRetryCompatible({
      graph: publishedVersion.graph,
      installationId: data.installation_id,
      expectedInstallationId: input.expectedInstallationId,
      expectedSourceType: input.expectedSourceType,
    })
  ) {
    return null;
  }

  return data.published_version_id;
}

type EnqueueJobRunRetryDeps = {
  enqueueAutomationJobRun: typeof enqueueAutomationJobRun;
  loadOwnedPublishedFlowVersionId: typeof loadOwnedPublishedFlowVersionId;
  now: () => number;
};

const defaultEnqueueJobRunRetryDeps: EnqueueJobRunRetryDeps = {
  enqueueAutomationJobRun,
  loadOwnedPublishedFlowVersionId,
  now: Date.now,
};

async function loadJobRunRow(jobRunId: string) {
  const { data, error } = await supabaseAdmin
    .from("job_runs")
    .select("*")
    .eq("id", jobRunId)
    .maybeSingle<JobRunRow>();

  if (error) {
    throw new Error(`Failed to load job run: ${error.message}`);
  }

  return data;
}

export async function loadJobRunRetryContext(jobRunId: string) {
  const run = await loadJobRunRow(jobRunId);
  if (!run) return null;

  if (run.assignment_id) {
    const { data: assignment, error: assignmentError } = await supabaseAdmin
      .from("assignments")
      .select("id, repo_id, type")
      .eq("id", run.assignment_id)
      .maybeSingle<{
        id: string;
        repo_id: string;
        type: string;
      }>();

    if (assignmentError) {
      throw new Error(`Failed to load assignment: ${assignmentError.message}`);
    }
    if (!assignment) return null;

    const { data: repo, error: repoError } = await supabaseAdmin
      .from("repos")
      .select("id, user_id, github_installation_id")
      .eq("id", assignment.repo_id)
      .maybeSingle<{
        id: string;
        user_id: string;
        github_installation_id: number | null;
      }>();

    if (repoError) {
      throw new Error(`Failed to load repo: ${repoError.message}`);
    }
    if (!repo) return null;

    return {
      run,
      userId: repo.user_id,
      sourceType: assignment.type,
      assignmentId: run.assignment_id,
      triggerId: run.trigger_id,
      flowId: run.flow_id,
      flowVersionId: run.flow_version_id,
      repoId: repo.id,
      installationId: repo.github_installation_id,
      metadata: run.metadata,
    } satisfies JobRunRetryContext;
  }

  if (run.trigger_id) {
    const { data: trigger, error: triggerError } = await supabaseAdmin
      .from("triggers")
      .select("id, user_id, installation_id, event")
      .eq("id", run.trigger_id)
      .maybeSingle<{
        id: string;
        user_id: string;
        installation_id: number;
        event: string;
      }>();

    if (triggerError) {
      throw new Error(`Failed to load trigger: ${triggerError.message}`);
    }
    if (!trigger) return null;

    return {
      run,
      userId: trigger.user_id,
      sourceType: trigger.event,
      assignmentId: run.assignment_id,
      triggerId: run.trigger_id,
      flowId: run.flow_id,
      flowVersionId: run.flow_version_id,
      repoId:
        typeof run.metadata?.repo_id === "string" ? run.metadata.repo_id : null,
      installationId: trigger.installation_id,
      metadata: run.metadata,
    } satisfies JobRunRetryContext;
  }

  if (!run.flow_id) {
    return null;
  }

  const { data: flow, error: flowError } = await supabaseAdmin
    .from("flows")
    .select("id, user_id, installation_id, published_version_id")
    .eq("id", run.flow_id)
    .maybeSingle<{
      id: string;
      user_id: string;
      installation_id: number;
      published_version_id: string | null;
    }>();

  if (flowError) {
    throw new Error(`Failed to load flow: ${flowError.message}`);
  }
  if (!flow) return null;

  const scope = await loadUserAutomationScope(flow.user_id, {
    flowVersionIds: [
      run.flow_version_id,
      typeof run.metadata?.flow_version_id === "string"
        ? run.metadata.flow_version_id
        : null,
      flow.published_version_id,
    ].filter(Boolean) as string[],
  });
  const attribution = resolveFlowVersionAttribution(scope, {
    flowId: run.flow_id,
    flowVersionId: run.flow_version_id,
    metadata: run.metadata,
  });

  return {
    run,
    userId: flow.user_id,
    sourceType:
      attribution?.sourceType ??
      (typeof run.metadata?.source_type === "string"
        ? run.metadata.source_type
        : "manual_retry"),
    assignmentId: run.assignment_id,
    triggerId: run.trigger_id,
    flowId: run.flow_id,
    flowVersionId: run.flow_version_id,
    repoId:
      typeof run.metadata?.repo_id === "string" ? run.metadata.repo_id : null,
    installationId:
      typeof run.metadata?.installation_id === "number"
        ? run.metadata.installation_id
        : flow.installation_id,
    metadata: run.metadata,
  } satisfies JobRunRetryContext;
}

export function createEnqueueJobRunRetry(
  overrides: Partial<EnqueueJobRunRetryDeps> = {}
) {
  const deps: EnqueueJobRunRetryDeps = {
    ...defaultEnqueueJobRunRetryDeps,
    ...overrides,
  };

  return async function enqueueJobRunRetry(input: {
    retryContext: JobRunRetryContext;
    idempotencyKeyPrefix: string;
    /**
     * Stable key for event-driven callers such as GitHub webhooks. Interactive
     * retries omit this so each user action remains a distinct attempt.
     */
    idempotencyKey?: string;
    versionMode: JobRunRetryVersionMode;
    metadataPatch?: Record<string, unknown>;
  }) {
    const existingMetadata = input.retryContext.metadata ?? undefined;
    const metadataPatch = input.metadataPatch ?? undefined;
    const retryMetadata: Record<string, unknown> = {
      ...existingMetadata,
      ...metadataPatch,
    };
    if (metadataPatch?.retry_latest_published_unavailable !== true) {
      delete retryMetadata.retry_latest_published_unavailable;
    }
    let selectedFlowVersionId = input.retryContext.flowVersionId;

    if (input.versionMode === "latest_published") {
      if (!input.retryContext.flowId) {
        throw new JobRunRetryVersionError();
      }

      selectedFlowVersionId = await deps.loadOwnedPublishedFlowVersionId({
        userId: input.retryContext.userId,
        flowId: input.retryContext.flowId,
        expectedInstallationId: input.retryContext.installationId,
        expectedSourceType: input.retryContext.sourceType,
      });

      if (!selectedFlowVersionId) {
        throw new JobRunRetryVersionError();
      }
    }

    return deps.enqueueAutomationJobRun({
      userId: input.retryContext.userId,
      assignmentId: input.retryContext.assignmentId,
      triggerId: input.retryContext.triggerId,
      retryOfJobRunId: input.retryContext.run.id,
      flowId: input.retryContext.flowId,
      flowVersionId: selectedFlowVersionId,
      repoId: input.retryContext.repoId,
      installationId: input.retryContext.installationId,
      sourceKind: "manual_retry",
      sourceType: input.retryContext.sourceType,
      idempotencyKey:
        input.idempotencyKey?.trim() ||
        `${input.idempotencyKeyPrefix}:${input.retryContext.run.id}:${deps.now()}`,
      metadata: {
        ...retryMetadata,
        source_type: input.retryContext.sourceType,
        repo_id: input.retryContext.repoId,
        installation_id: input.retryContext.installationId,
        flow_id: input.retryContext.flowId,
        flow_version_id: selectedFlowVersionId,
        retry_version_mode: input.versionMode,
        retry_original_flow_version_id: input.retryContext.flowVersionId,
        retry_selected_flow_version_id: selectedFlowVersionId,
      },
    });
  };
}

export const enqueueJobRunRetry = createEnqueueJobRunRetry();
