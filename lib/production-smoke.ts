import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  getAutomationCostState,
  getAutomationStatusPresentation,
} from "@/lib/observability/automation-run-presentation";
import { REPO_SELECT_WITH_WORKSPACE } from "@/lib/repos";
import { isRecord } from "@/lib/utils/type-guards";
import { WORKSPACE_COLUMNS } from "@/lib/workspaces";

export type ProductionSmokeCheckName =
  | "repos_select"
  | "repo_workspace_ids_select"
  | "workspaces_select"
  | "github_installations_count"
  | "repo_baseline_snapshot_metadata"
  | "review_run_observability_projection";

export type ProductionSmokeCheckResult = {
  name: ProductionSmokeCheckName;
  ok: boolean;
  detail: string;
};

export type ProductionSmokeSummary = {
  ok: boolean;
  checkedAt: string;
  checks: ProductionSmokeCheckResult[];
};

type ProductionSmokeDeps = {
  checkReposSelect: () => Promise<string>;
  checkRepoWorkspaceIdsSelect: () => Promise<string>;
  checkWorkspacesSelect: () => Promise<string>;
  checkGithubInstallationsCount: () => Promise<string>;
  checkRepoBaselineSnapshotMetadata: () => Promise<string>;
  checkReviewRunObservabilityProjection: () => Promise<string>;
};

type ReviewRunObservabilitySample = {
  jobRunId: string | null;
  status: string;
  error: string | null;
  costUsd: number | null;
  metadata: Record<string, unknown> | null;
};

type ReviewRunFailureRow = {
  job_run_id: string | null;
  metadata: Record<string, unknown> | null;
};

type ReviewRunJobRow = {
  id: string;
  status: string;
  cost_usd: number | null;
  error: string | null;
  metadata: Record<string, unknown> | null;
};

// Review-run timeout metadata may be written on either the dispatch event or
// the job run. Merge both sources so the smoke check evaluates the same
// structured fields users see in the observability UI, with job metadata
// winning when both sides provide the same key.
export function mergeReviewRunObservabilityMetadata(
  dispatchMetadata: unknown,
  jobMetadata: unknown
) {
  const merged: Record<string, unknown> = {};

  if (isRecord(dispatchMetadata)) {
    Object.assign(merged, dispatchMetadata);
  }

  if (isRecord(jobMetadata)) {
    Object.assign(merged, jobMetadata);
  }

  return Object.keys(merged).length > 0 ? merged : null;
}

function formatMissingReviewRunIds(jobRunIds: Array<string | null>) {
  const labels = jobRunIds.map((jobRunId) =>
    typeof jobRunId === "string" && jobRunId.length > 0
      ? jobRunId
      : "(missing job_run_id)"
  );
  const preview = labels.slice(0, 3).join(", ");
  const remainder = labels.length > 3 ? `, +${labels.length - 3} more` : "";

  return `${preview}${remainder}`;
}

export function buildReviewRunObservabilitySamples(
  failureRows: ReviewRunFailureRow[],
  jobsById: Map<string, ReviewRunJobRow>
) {
  const missingJobRunIds: Array<string | null> = [];
  const samples: ReviewRunObservabilitySample[] = [];

  for (const row of failureRows) {
    if (typeof row.job_run_id !== "string" || row.job_run_id.length === 0) {
      missingJobRunIds.push(row.job_run_id);
      continue;
    }

    const job = jobsById.get(row.job_run_id);
    if (!job) {
      missingJobRunIds.push(row.job_run_id);
      continue;
    }

    samples.push({
      jobRunId: row.job_run_id,
      status: job.status,
      error: job.error,
      costUsd: job.cost_usd,
      metadata: mergeReviewRunObservabilityMetadata(row.metadata, job.metadata),
    });
  }

  if (missingJobRunIds.length > 0) {
    throw new Error(
      `Review dispatch events are missing linked job_runs (${formatMissingReviewRunIds(
        missingJobRunIds
      )})`
    );
  }

  return samples;
}

async function checkReposSelect() {
  const { error } = await supabaseAdmin
    .from("repos")
    .select(REPO_SELECT_WITH_WORKSPACE)
    .limit(1);

  if (error) throw new Error(error.message);
  return "Queried repos with workspace join";
}

async function checkRepoWorkspaceIdsSelect() {
  const { error } = await supabaseAdmin
    .from("repos")
    .select("workspace_id")
    .limit(1);

  if (error) throw new Error(error.message);
  return "Queried repo workspace ids";
}

async function checkWorkspacesSelect() {
  const { error } = await supabaseAdmin
    .from("workspaces")
    .select(WORKSPACE_COLUMNS)
    .limit(1);

  if (error) throw new Error(error.message);
  return "Queried workspaces with billing and Vercel link fields";
}

async function checkGithubInstallationsCount() {
  const { error } = await supabaseAdmin
    .from("github_installations")
    .select("*", { count: "exact", head: true });

  if (error) throw new Error(error.message);
  return "Counted GitHub installations";
}

/**
 * Confirms the baseline-snapshot columns exist in prod (schema drift guard
 * after the fast-spawn rollout) and surfaces any row where `snapshot_id` is
 * set but `snapshot_lockfile_hash` is missing — which would indicate a
 * pre-fast-spawn snapshot that the baseline-restore path would reject.
 */
async function checkRepoBaselineSnapshotMetadata() {
  const { data, error } = await supabaseAdmin
    .from("repos")
    .select(
      "id, snapshot_id, snapshot_lockfile_hash, snapshot_created_at, snapshot_commit_sha"
    )
    .not("snapshot_id", "is", null)
    .limit(25);

  if (error) throw new Error(error.message);

  const rows = (data ?? []) as Array<{
    id: string;
    snapshot_id: string | null;
    snapshot_lockfile_hash: string | null;
    snapshot_created_at: string | null;
    snapshot_commit_sha: string | null;
  }>;

  const missingHashCount = rows.filter(
    (row) => row.snapshot_id && !row.snapshot_lockfile_hash
  ).length;

  return `Verified baseline snapshot columns (${rows.length} sampled${
    missingHashCount > 0
      ? `, ${missingHashCount} pre-fast-spawn row(s) without lockfile hash`
      : ""
  })`;
}

export function summarizeReviewRunObservabilityProjection(
  samples: ReviewRunObservabilitySample[]
) {
  if (samples.length === 0) {
    return "No recent failed Trigger review runs to sample";
  }

  let timedOutCount = 0;
  let partialCostCount = 0;
  let missingBudgetCount = 0;
  let unknownCostCount = 0;

  for (const sample of samples) {
    const status = getAutomationStatusPresentation({
      status: sample.status,
      metadata: sample.metadata,
      error: sample.error,
    });

    if (status.label.trim().length === 0) {
      throw new Error(
        `Failed review run ${sample.jobRunId ?? "unknown"} is missing a failure label`
      );
    }

    if (status.isTimedOut) {
      timedOutCount += 1;
      if (status.failureClass === "timeout" && status.timeoutBudgetMs == null) {
        throw new Error(
          `Timed out review run ${sample.jobRunId ?? "unknown"} is missing timeout budget metadata`
        );
      }
      if (status.failureClass !== "timeout" && status.timeoutBudgetMs == null) {
        missingBudgetCount += 1;
      }
    }

    const costState = getAutomationCostState({
      status: sample.status,
      costUsd: sample.costUsd,
    });
    if (costState === "partial") partialCostCount += 1;
    if (costState === "unknown") unknownCostCount += 1;
  }

  return `Sampled ${samples.length} failed Trigger review run(s) (${timedOutCount} timed out, ${partialCostCount} partial cost, ${unknownCostCount} unknown cost${
    missingBudgetCount > 0
      ? `, ${missingBudgetCount} heuristic timeout without budget`
      : ""
  })`;
}

async function checkReviewRunObservabilityProjection() {
  const { data: failures, error: failuresError } = await supabaseAdmin
    .from("automation_dispatch_events")
    .select("job_run_id, source_type, reason, metadata, created_at")
    .eq("event_kind", "control")
    .eq("outcome", "failed")
    .in("source_type", ["pr_review", "push_review"])
    .order("created_at", { ascending: false })
    .limit(10);

  if (failuresError) {
    throw new Error(failuresError.message);
  }

  const failureRows = (failures ?? []) as Array<{
    job_run_id: string | null;
    source_type: string;
    reason: string | null;
    metadata: Record<string, unknown> | null;
    created_at: string;
  }>;
  const jobIds = Array.from(
    new Set(
      failureRows
        .map((row) => row.job_run_id)
        .filter((value): value is string => typeof value === "string")
    )
  );

  const { data: jobs, error: jobsError } =
    jobIds.length > 0
      ? await supabaseAdmin
          .from("job_runs")
          .select("id, status, cost_usd, error, metadata")
          .in("id", jobIds)
      : { data: [], error: null };

  if (jobsError) {
    throw new Error(jobsError.message);
  }

  const jobsById = new Map(
    ((jobs ?? []) as ReviewRunJobRow[]).map((job) => [job.id, job])
  );

  return summarizeReviewRunObservabilityProjection(
    buildReviewRunObservabilitySamples(failureRows, jobsById)
  );
}

const defaultDeps: ProductionSmokeDeps = {
  checkReposSelect,
  checkRepoWorkspaceIdsSelect,
  checkWorkspacesSelect,
  checkGithubInstallationsCount,
  checkRepoBaselineSnapshotMetadata,
  checkReviewRunObservabilityProjection,
};

async function runCheck(
  name: ProductionSmokeCheckName,
  fn: () => Promise<string>
): Promise<ProductionSmokeCheckResult> {
  try {
    const detail = await fn();
    return { name, ok: true, detail };
  } catch (error) {
    const detail =
      error instanceof Error
        ? error.message
        : "Unknown production smoke failure";
    return { name, ok: false, detail };
  }
}

export async function runProductionSmokeChecks(
  overrides: Partial<ProductionSmokeDeps> = {}
): Promise<ProductionSmokeSummary> {
  const deps: ProductionSmokeDeps = {
    ...defaultDeps,
    ...overrides,
  };

  const checks = await Promise.all([
    runCheck("repos_select", deps.checkReposSelect),
    runCheck("repo_workspace_ids_select", deps.checkRepoWorkspaceIdsSelect),
    runCheck("workspaces_select", deps.checkWorkspacesSelect),
    runCheck("github_installations_count", deps.checkGithubInstallationsCount),
    runCheck(
      "repo_baseline_snapshot_metadata",
      deps.checkRepoBaselineSnapshotMetadata
    ),
    runCheck(
      "review_run_observability_projection",
      deps.checkReviewRunObservabilityProjection
    ),
  ]);

  return {
    ok: checks.every((check) => check.ok),
    checkedAt: new Date().toISOString(),
    checks,
  };
}
