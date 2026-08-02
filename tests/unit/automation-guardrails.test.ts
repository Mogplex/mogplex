import assert from "node:assert/strict";
import test from "node:test";

type AutomationScope = {
  jobRunId?: string;
  status?: string | null;
  sourceKind: "assignment" | "trigger" | "flow";
  sourceType: string;
  sourceId: string | null;
  repoId: string | null;
  installationId: number | null;
  createdAt?: string | null;
};

type GuardedQueuedJob = {
  assignment_id?: string;
  trigger_id?: string;
  status: "pending";
  metadata: Record<string, unknown>;
  idempotency_key: string;
  scope: AutomationScope;
};

async function loadGuardrailFns() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "service-role-key";
  return import("../../lib/workflows/automation-guardrails");
}

function makeScope(overrides: Partial<AutomationScope> = {}): AutomationScope {
  return {
    jobRunId: overrides.jobRunId,
    status: overrides.status ?? "pending",
    sourceKind: overrides.sourceKind ?? "assignment",
    sourceType: overrides.sourceType ?? "cron_refactor",
    sourceId: overrides.sourceId ?? "assignment-1",
    repoId: overrides.repoId ?? "repo-1",
    installationId: overrides.installationId ?? 101,
    createdAt: overrides.createdAt ?? "2026-03-21T20:00:00.000Z",
  };
}

function makeQueuedJob(
  overrides: Partial<GuardedQueuedJob> = {}
): GuardedQueuedJob {
  const scope = {
    ...makeScope(),
    ...overrides.scope,
  };

  return {
    assignment_id: overrides.assignment_id ?? "assignment-1",
    status: "pending",
    metadata: overrides.metadata ?? {},
    idempotency_key:
      overrides.idempotency_key ?? `job:${scope.sourceId}:${scope.sourceType}`,
    scope,
  };
}

test("start guard allows many concurrent runs for the same repo", async () => {
  const { getStartBlockReason } = await loadGuardrailFns();
  const blocked = getStartBlockReason(
    makeScope({ jobRunId: "candidate", status: "pending" }),
    Array.from({ length: 5 }, (_, index) =>
      makeScope({ jobRunId: `running-${index}`, status: "running" })
    )
  );

  assert.equal(blocked, null);
});

test("start guard blocks when installation concurrency is already saturated", async () => {
  const { getStartBlockReason } = await loadGuardrailFns();
  const blocked = getStartBlockReason(
    makeScope({ jobRunId: "candidate", status: "pending" }),
    Array.from({ length: 8 }, (_, index) =>
      makeScope({
        jobRunId: `running-${index}`,
        status: "running",
        repoId: `repo-${index}`,
      })
    )
  );

  assert.equal(blocked, "INSTALLATION_CONCURRENCY_LIMIT");
});

test("enqueue suppression drops duplicate-sensitive jobs but allows mentions through", async () => {
  const { filterEnqueueCandidates } = await loadGuardrailFns();
  const existing = [
    makeScope({
      jobRunId: "existing-push",
      status: "pending",
      sourceKind: "trigger",
      sourceType: "push",
      sourceId: "trigger-1",
      repoId: "repo-1",
      installationId: 101,
    }),
  ];

  const duplicatePush = makeQueuedJob({
    trigger_id: "trigger-1",
    idempotency_key: "push-1",
    scope: makeScope({
      sourceKind: "trigger",
      sourceType: "push",
      sourceId: "trigger-1",
      repoId: "repo-1",
      installationId: 101,
    }),
  });

  const mention = makeQueuedJob({
    trigger_id: "trigger-2",
    idempotency_key: "mention-1",
    scope: makeScope({
      sourceKind: "trigger",
      sourceType: "mention",
      sourceId: "trigger-2",
      repoId: "repo-1",
      installationId: 101,
    }),
  });

  const result = filterEnqueueCandidates([duplicatePush, mention], existing);

  assert.equal(result.accepted.length, 1);
  assert.equal(result.accepted[0]?.idempotency_key, "mention-1");
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0]?.reason, "ACTIVE_DUPLICATE");
});

test("flow scopes are classified separately from legacy triggers", async () => {
  const { filterEnqueueCandidates } = await loadGuardrailFns();
  const existing = [
    makeScope({
      jobRunId: "existing-flow",
      status: "pending",
      sourceKind: "flow",
      sourceType: "push",
      sourceId: "flow-1",
      repoId: "repo-1",
      installationId: 101,
    }),
  ];

  const duplicateFlow = makeQueuedJob({
    trigger_id: undefined,
    idempotency_key: "flow-push-1",
    scope: makeScope({
      sourceKind: "flow",
      sourceType: "push",
      sourceId: "flow-1",
      repoId: "repo-1",
      installationId: 101,
    }),
  });

  const result = filterEnqueueCandidates([duplicateFlow], existing);

  assert.equal(result.accepted.length, 0);
  assert.equal(result.skipped[0]?.reason, "ACTIVE_DUPLICATE");
});

test("enqueue suppression enforces repo queue limits", async () => {
  const { filterEnqueueCandidates } = await loadGuardrailFns();
  const existing = Array.from({ length: 25 }, (_, index) =>
    makeScope({
      jobRunId: `job-${index}`,
      status: index < 2 ? "running" : "pending",
      repoId: "repo-1",
      installationId: 101,
      createdAt: `2026-03-21T20:${String(index).padStart(2, "0")}:00.000Z`,
    })
  );

  const candidate = makeQueuedJob({
    idempotency_key: "repo-over-limit",
    scope: makeScope({
      sourceId: "assignment-2",
      repoId: "repo-1",
      installationId: 101,
    }),
  });

  const result = filterEnqueueCandidates([candidate], existing);

  assert.equal(result.accepted.length, 0);
  assert.equal(result.skipped[0]?.reason, "REPO_PENDING_LIMIT");
});

test("queue release prioritizes same-repo jobs but can also fill installation capacity", async () => {
  const { selectQueuedJobsToStart } = await loadGuardrailFns();
  const selected = selectQueuedJobsToStart({
    releasedScope: makeScope({
      jobRunId: "finished-job",
      status: "success",
      sourceId: "assignment-finished",
      repoId: "repo-1",
      installationId: 101,
    }),
    pendingScopes: [
      makeScope({
        jobRunId: "repo-peer",
        status: "pending",
        repoId: "repo-1",
        installationId: 101,
        createdAt: "2026-03-21T20:10:00.000Z",
      }),
      makeScope({
        jobRunId: "install-peer",
        status: "pending",
        repoId: "repo-2",
        installationId: 101,
        createdAt: "2026-03-21T20:05:00.000Z",
      }),
    ],
    runningScopes: [],
  });

  assert.deepEqual(selected, ["repo-peer", "install-peer"]);
});
