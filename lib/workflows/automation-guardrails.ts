import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Automation concurrency/queue caps. Every cap here predates the
 * no-artificial-limits rule in AGENTS.md and remains only until Charles
 * reviews it — do not add caps or change values without his sign-off.
 * (The per-repo running limit that used to live here was removed
 * 2026-07-06 at his request.)
 *
 * TOOL_APPROVAL_WAIT_BUDGET_MS (lib/flows/tool-approval.ts) — ACTIVE,
 * approved by Charles 2026-07-22 as a safety backstop. Counts cumulative
 * human-approval waiting time (10 min) shared across every gated tool loop
 * of one flow-agent node run (keyed job_run + node). Enforced by the
 * tool-approval gate before each wait; only time actually spent waiting is
 * deducted. When hit, further tool calls are denied immediately
 * (deny-and-continue — the run finishes, work is never dropped mid-flight).
 * It exists because approval waits run inside the generateText tool loop,
 * which sits under the 25-min generation total timeout and the 30-min
 * Trigger.dev task cap: an unbounded wait would fail the whole run there
 * and lose all completed work.
 *
 * maxRunningPerInstallation — ACTIVE. Max job runs executing at once per
 * GitHub installation. Enforced authoritatively by the
 * `claim_automation_job_run` Postgres function (the app passes this value;
 * see automation-job-workflow.ts) and mirrored by `getStartBlockReason` /
 * `selectQueuedJobsToStart` when picking pending jobs to start. When hit,
 * the run stays PENDING with reason INSTALLATION_CONCURRENCY_LIMIT and is
 * retried automatically as running jobs in the installation finish — work
 * is delayed, never dropped. The SQL function has a matching DEFAULT 8
 * that only applies if a caller omits the parameter; this constant is the
 * source of truth.
 *
 * maxPendingPerRepo / maxPendingPerInstallation — DORMANT. Max
 * pending+running runs a repo (25) or installation (100) may have queued
 * at enqueue time. Only `filterEnqueueCandidates` enforces them, and as of
 * 2026-07-06 nothing in production calls it — the caps currently gate
 * nothing. If ever wired up, note the failure mode differs from the
 * running cap: candidates over the cap are skipped with
 * REPO_PENDING_LIMIT / INSTALLATION_PENDING_LIMIT and never enqueued, so
 * that work is dropped, not deferred.
 */
export const AUTOMATION_LIMITS = {
  maxRunningPerInstallation: 8,
  maxPendingPerRepo: 25,
  maxPendingPerInstallation: 100,
} as const;

export const DUPLICATE_SENSITIVE_SOURCE_TYPES = new Set([
  "push",
  "push_review",
  "ci_failure",
  "cron",
  "cron_refactor",
]);

export type AutomationScope = {
  jobRunId?: string;
  status?: string | null;
  sourceKind: "assignment" | "trigger" | "flow";
  sourceType: string;
  sourceId: string | null;
  repoId: string | null;
  installationId: number | null;
  createdAt?: string | null;
};

export type GuardedQueuedJob = {
  assignment_id?: string;
  trigger_id?: string;
  flow_id?: string | null;
  status: "pending";
  metadata: Record<string, unknown>;
  idempotency_key: string;
  scope: AutomationScope;
};

type JobRunScopeRow = {
  id: string;
  assignment_id: string | null;
  trigger_id: string | null;
  flow_id: string | null;
  status: string | null;
  created_at: string | null;
  metadata: Record<string, unknown> | null;
};

type AssignmentRef = {
  id: string;
  repo_id: string;
  type: string;
};

type TriggerRef = {
  id: string;
  installation_id: number;
  event: string;
};

type FlowRef = {
  id: string;
  installation_id: number;
};

type RepoRef = {
  id: string;
  github_installation_id: number | null;
};

type ScopeRefs = {
  assignmentsById: Map<string, AssignmentRef>;
  triggersById: Map<string, TriggerRef>;
  flowsById: Map<string, FlowRef>;
  reposById: Map<string, RepoRef>;
};

export type StartGuardReason = "INSTALLATION_CONCURRENCY_LIMIT";

export type QueueGuardReason =
  | StartGuardReason
  | "REPO_PENDING_LIMIT"
  | "INSTALLATION_PENDING_LIMIT"
  | "ACTIVE_DUPLICATE";

export function describeStartGuardReason(reason: StartGuardReason) {
  if (reason === "INSTALLATION_CONCURRENCY_LIMIT") {
    return "Installation concurrency limit reached";
  }
  return reason;
}

function getDuplicateKey(scope: AutomationScope) {
  return `${scope.sourceKind}:${scope.sourceId || "unknown"}:${scope.sourceType}:${scope.repoId || "none"}`;
}

function toNullableString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function toNullableNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

async function loadScopeRefs(
  rows: JobRunScopeRow[],
  adminClient: SupabaseClient = supabaseAdmin
) {
  const assignmentIds = Array.from(
    new Set(rows.map((row) => row.assignment_id).filter(Boolean) as string[])
  );
  const triggerIds = Array.from(
    new Set(rows.map((row) => row.trigger_id).filter(Boolean) as string[])
  );
  const flowIds = Array.from(
    new Set(rows.map((row) => row.flow_id).filter(Boolean) as string[])
  );

  const [assignmentsResult, triggersResult, flowsResult] = await Promise.all([
    assignmentIds.length > 0
      ? adminClient
          .from("assignments")
          .select("id, repo_id, type")
          .in("id", assignmentIds)
      : Promise.resolve({ data: [], error: null }),
    triggerIds.length > 0
      ? adminClient
          .from("triggers")
          .select("id, installation_id, event")
          .in("id", triggerIds)
      : Promise.resolve({ data: [], error: null }),
    flowIds.length > 0
      ? adminClient
          .from("flows")
          .select("id, installation_id")
          .in("id", flowIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (assignmentsResult.error) {
    throw new Error(
      `Failed to load assignment scopes: ${assignmentsResult.error.message}`
    );
  }

  if (triggersResult.error) {
    throw new Error(
      `Failed to load trigger scopes: ${triggersResult.error.message}`
    );
  }

  if (flowsResult.error) {
    throw new Error(`Failed to load flow scopes: ${flowsResult.error.message}`);
  }

  const assignmentRows = assignmentsResult.data || [];
  const repoIds = Array.from(
    new Set(assignmentRows.map((assignment) => assignment.repo_id))
  );

  const { data: repos, error: reposError } =
    repoIds.length > 0
      ? await adminClient
          .from("repos")
          .select("id, github_installation_id")
          .in("id", repoIds)
      : { data: [], error: null };

  if (reposError) {
    throw new Error(`Failed to load repo scopes: ${reposError.message}`);
  }

  return {
    assignmentsById: new Map(
      assignmentRows.map((assignment) => [assignment.id, assignment])
    ),
    triggersById: new Map(
      (triggersResult.data || []).map((trigger) => [trigger.id, trigger])
    ),
    flowsById: new Map((flowsResult.data || []).map((flow) => [flow.id, flow])),
    reposById: new Map((repos || []).map((repo) => [repo.id, repo])),
  } satisfies ScopeRefs;
}

function resolveScopeForStoredRun(
  row: JobRunScopeRow,
  refs: ScopeRefs
): AutomationScope {
  if (row.assignment_id) {
    const assignment = refs.assignmentsById.get(row.assignment_id);
    const repo = assignment ? refs.reposById.get(assignment.repo_id) : null;
    return {
      jobRunId: row.id,
      status: row.status,
      sourceKind: "assignment",
      sourceType:
        assignment?.type ||
        toNullableString(row.metadata?.source_type) ||
        "assignment",
      sourceId: row.assignment_id,
      repoId: assignment?.repo_id || toNullableString(row.metadata?.repo_id),
      installationId:
        repo?.github_installation_id ??
        toNullableNumber(row.metadata?.installation_id),
      createdAt: row.created_at,
    };
  }

  if (row.flow_id) {
    const flow = refs.flowsById.get(row.flow_id);
    return {
      jobRunId: row.id,
      status: row.status,
      sourceKind: "flow",
      sourceType: toNullableString(row.metadata?.source_type) || "flow",
      sourceId: row.flow_id,
      repoId: toNullableString(row.metadata?.repo_id),
      installationId:
        flow?.installation_id ??
        toNullableNumber(row.metadata?.installation_id),
      createdAt: row.created_at,
    };
  }

  const trigger = row.trigger_id ? refs.triggersById.get(row.trigger_id) : null;
  return {
    jobRunId: row.id,
    status: row.status,
    sourceKind: "trigger",
    sourceType:
      trigger?.event ||
      toNullableString(row.metadata?.source_type) ||
      "trigger",
    sourceId: row.trigger_id || row.flow_id,
    repoId: toNullableString(row.metadata?.repo_id),
    installationId:
      trigger?.installation_id ??
      toNullableNumber(row.metadata?.installation_id),
    createdAt: row.created_at,
  };
}

export async function loadAutomationScopesByStatus(
  statuses: Array<"pending" | "running">
) {
  if (statuses.length === 0) return [] as AutomationScope[];

  const { data: rows, error } = await supabaseAdmin
    .from("job_runs")
    .select(
      "id, assignment_id, trigger_id, flow_id, status, created_at, metadata"
    )
    .in("status", statuses)
    .order("created_at", { ascending: true })
    .limit(500);

  if (error) {
    throw new Error(`Failed to load active job scopes: ${error.message}`);
  }

  const typedRows = (rows || []) as JobRunScopeRow[];
  const refs = await loadScopeRefs(typedRows);
  return typedRows.map((row) => resolveScopeForStoredRun(row, refs));
}

export async function loadAutomationScopeForJobRun(
  jobRunId: string,
  adminClient: SupabaseClient = supabaseAdmin
) {
  const { data: row, error } = await adminClient
    .from("job_runs")
    .select(
      "id, assignment_id, trigger_id, flow_id, status, created_at, metadata"
    )
    .eq("id", jobRunId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load job scope: ${error.message}`);
  }

  if (!row) return null;

  const refs = await loadScopeRefs([row as JobRunScopeRow], adminClient);
  return resolveScopeForStoredRun(row as JobRunScopeRow, refs);
}

export function getStartBlockReason(
  scope: AutomationScope,
  runningScopes: AutomationScope[],
  limits = AUTOMATION_LIMITS
): StartGuardReason | null {
  if (scope.installationId != null) {
    const runningForInstallation = runningScopes.filter(
      (candidate) =>
        candidate.installationId === scope.installationId &&
        candidate.jobRunId !== scope.jobRunId
    ).length;
    if (runningForInstallation >= limits.maxRunningPerInstallation) {
      return "INSTALLATION_CONCURRENCY_LIMIT";
    }
  }

  return null;
}

export function filterEnqueueCandidates(
  candidates: GuardedQueuedJob[],
  existingScopes: AutomationScope[],
  limits = AUTOMATION_LIMITS
) {
  const accepted: GuardedQueuedJob[] = [];
  const skipped: Array<{
    candidate: GuardedQueuedJob;
    reason: QueueGuardReason;
  }> = [];
  const simulatedScopes = [...existingScopes];

  for (const candidate of candidates) {
    const { scope } = candidate;

    if (DUPLICATE_SENSITIVE_SOURCE_TYPES.has(scope.sourceType)) {
      const hasDuplicate = simulatedScopes.some((existing) => {
        if (existing.status !== "pending" && existing.status !== "running")
          return false;
        return getDuplicateKey(existing) === getDuplicateKey(scope);
      });

      if (hasDuplicate) {
        skipped.push({ candidate, reason: "ACTIVE_DUPLICATE" });
        continue;
      }
    }

    if (scope.repoId) {
      const queuedForRepo = simulatedScopes.filter(
        (existing) =>
          existing.repoId === scope.repoId &&
          (existing.status === "pending" || existing.status === "running")
      ).length;
      if (queuedForRepo >= limits.maxPendingPerRepo) {
        skipped.push({ candidate, reason: "REPO_PENDING_LIMIT" });
        continue;
      }
    }

    if (scope.installationId != null) {
      const queuedForInstallation = simulatedScopes.filter(
        (existing) =>
          existing.installationId === scope.installationId &&
          (existing.status === "pending" || existing.status === "running")
      ).length;
      if (queuedForInstallation >= limits.maxPendingPerInstallation) {
        skipped.push({ candidate, reason: "INSTALLATION_PENDING_LIMIT" });
        continue;
      }
    }

    accepted.push(candidate);
    simulatedScopes.push({ ...scope, status: "pending" });
  }

  return { accepted, skipped };
}

function matchesReleasedScope(
  candidate: AutomationScope,
  releasedScope: AutomationScope
) {
  if (
    releasedScope.repoId &&
    candidate.repoId &&
    candidate.repoId === releasedScope.repoId
  ) {
    return true;
  }

  if (
    releasedScope.installationId != null &&
    candidate.installationId != null
  ) {
    return candidate.installationId === releasedScope.installationId;
  }

  if (releasedScope.repoId && candidate.repoId) {
    return candidate.repoId === releasedScope.repoId;
  }

  return false;
}

export function selectQueuedJobsToStart(input: {
  releasedScope: AutomationScope;
  pendingScopes: AutomationScope[];
  runningScopes: AutomationScope[];
  limits?: typeof AUTOMATION_LIMITS;
}) {
  const limits = input.limits || AUTOMATION_LIMITS;
  const selected: string[] = [];
  const simulatedRunning = [...input.runningScopes];
  const candidates = input.pendingScopes
    .filter(
      (candidate) =>
        candidate.jobRunId &&
        matchesReleasedScope(candidate, input.releasedScope)
    )
    .sort((a, b) => {
      const aRepoPriority =
        a.repoId && a.repoId === input.releasedScope.repoId ? 0 : 1;
      const bRepoPriority =
        b.repoId && b.repoId === input.releasedScope.repoId ? 0 : 1;
      if (aRepoPriority !== bRepoPriority) return aRepoPriority - bRepoPriority;
      return (
        new Date(a.createdAt || 0).getTime() -
        new Date(b.createdAt || 0).getTime()
      );
    });

  for (const candidate of candidates) {
    const reason = getStartBlockReason(candidate, simulatedRunning, limits);
    if (reason) continue;
    selected.push(candidate.jobRunId!);
    simulatedRunning.push({ ...candidate, status: "running" });
  }

  return selected;
}
