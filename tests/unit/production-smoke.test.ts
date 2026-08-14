import assert from "node:assert/strict";
import test from "node:test";

async function loadProductionSmoke() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../lib/production-smoke");
}

test("runProductionSmokeChecks returns ok when all checks succeed", async () => {
  const { runProductionSmokeChecks } = await loadProductionSmoke();

  const summary = await runProductionSmokeChecks({
    checkReposSelect: async () => "repos ok",
    checkRepoWorkspaceIdsSelect: async () => "repo workspace ids ok",
    checkWorkspacesSelect: async () => "workspaces ok",
    checkControlSessionsSelect: async () => "control sessions ok",
    checkGithubInstallationsCount: async () => "installations ok",
    checkRepoBaselineSnapshotMetadata: async () => "baseline ok",
    checkReviewRunObservabilityProjection: async () =>
      "review observability ok",
  });

  assert.equal(summary.ok, true);
  assert.deepEqual(summary.checks, [
    { name: "repos_select", ok: true, detail: "repos ok" },
    {
      name: "repo_workspace_ids_select",
      ok: true,
      detail: "repo workspace ids ok",
    },
    { name: "workspaces_select", ok: true, detail: "workspaces ok" },
    {
      name: "control_sessions_select",
      ok: true,
      detail: "control sessions ok",
    },
    {
      name: "github_installations_count",
      ok: true,
      detail: "installations ok",
    },
    {
      name: "repo_baseline_snapshot_metadata",
      ok: true,
      detail: "baseline ok",
    },
    {
      name: "review_run_observability_projection",
      ok: true,
      detail: "review observability ok",
    },
  ]);
});

test("runProductionSmokeChecks captures failures and keeps later checks running", async () => {
  const { runProductionSmokeChecks } = await loadProductionSmoke();

  const summary = await runProductionSmokeChecks({
    checkReposSelect: async () => {
      throw new Error("missing repos column");
    },
    checkRepoWorkspaceIdsSelect: async () => "repo workspace ids ok",
    checkWorkspacesSelect: async () => "workspaces ok",
    checkControlSessionsSelect: async () => {
      throw new Error("missing control_sessions table");
    },
    checkGithubInstallationsCount: async () => {
      throw new Error("installations unavailable");
    },
    checkRepoBaselineSnapshotMetadata: async () => "baseline ok",
    checkReviewRunObservabilityProjection: async () =>
      "review observability ok",
  });

  assert.equal(summary.ok, false);
  assert.deepEqual(summary.checks, [
    { name: "repos_select", ok: false, detail: "missing repos column" },
    {
      name: "repo_workspace_ids_select",
      ok: true,
      detail: "repo workspace ids ok",
    },
    { name: "workspaces_select", ok: true, detail: "workspaces ok" },
    {
      name: "control_sessions_select",
      ok: false,
      detail: "missing control_sessions table",
    },
    {
      name: "github_installations_count",
      ok: false,
      detail: "installations unavailable",
    },
    {
      name: "repo_baseline_snapshot_metadata",
      ok: true,
      detail: "baseline ok",
    },
    {
      name: "review_run_observability_projection",
      ok: true,
      detail: "review observability ok",
    },
  ]);
});

test("runProductionSmokeChecks reports baseline snapshot drift as a failure", async () => {
  const { runProductionSmokeChecks } = await loadProductionSmoke();
  const summary = await runProductionSmokeChecks({
    checkReposSelect: async () => "ok",
    checkRepoWorkspaceIdsSelect: async () => "ok",
    checkWorkspacesSelect: async () => "ok",
    checkControlSessionsSelect: async () => "ok",
    checkGithubInstallationsCount: async () => "ok",
    checkRepoBaselineSnapshotMetadata: async () => {
      throw new Error("column snapshot_lockfile_hash does not exist");
    },
    checkReviewRunObservabilityProjection: async () => "ok",
  });

  assert.equal(summary.ok, false);
  const baseline = summary.checks.find(
    (c) => c.name === "repo_baseline_snapshot_metadata"
  );
  assert.ok(baseline);
  assert.equal(baseline.ok, false);
  assert.match(baseline.detail, /snapshot_lockfile_hash/);
});

test("runProductionSmokeChecks reports review observability projection failures", async () => {
  const { runProductionSmokeChecks } = await loadProductionSmoke();
  const summary = await runProductionSmokeChecks({
    checkReposSelect: async () => "ok",
    checkRepoWorkspaceIdsSelect: async () => "ok",
    checkWorkspacesSelect: async () => "ok",
    checkControlSessionsSelect: async () => "ok",
    checkGithubInstallationsCount: async () => "ok",
    checkRepoBaselineSnapshotMetadata: async () => "ok",
    checkReviewRunObservabilityProjection: async () => {
      throw new Error(
        "Timed out review run job-1 is missing timeout budget metadata"
      );
    },
  });

  assert.equal(summary.ok, false);
  const reviewProjection = summary.checks.find(
    (c) => c.name === "review_run_observability_projection"
  );
  assert.ok(reviewProjection);
  assert.equal(reviewProjection.ok, false);
  assert.match(reviewProjection.detail, /missing timeout budget metadata/);
});

test("summarizeReviewRunObservabilityProjection reports heuristic timeouts without failing", async () => {
  const { summarizeReviewRunObservabilityProjection } =
    await loadProductionSmoke();

  const summary = summarizeReviewRunObservabilityProjection([
    {
      jobRunId: "job-1",
      status: "failed",
      error: "Gateway request timed out before the response body completed",
      costUsd: null,
      metadata: null,
    },
  ]);

  assert.match(summary, /1 timed out/);
  assert.match(summary, /1 unknown cost/);
  assert.match(summary, /1 heuristic timeout without budget/);
});

test("summarizeReviewRunObservabilityProjection fails on structured timeout rows without a budget", async () => {
  const { summarizeReviewRunObservabilityProjection } =
    await loadProductionSmoke();

  assert.throws(
    () =>
      summarizeReviewRunObservabilityProjection([
        {
          jobRunId: "job-1",
          status: "failed",
          error: "Automation model request timed out",
          costUsd: 0.0184,
          metadata: { model_failure_class: "timeout" },
        },
      ]),
    /missing timeout budget metadata/
  );
});

test("mergeReviewRunObservabilityMetadata prefers job-run timeout fields while retaining dispatch context", async () => {
  const { mergeReviewRunObservabilityMetadata } = await loadProductionSmoke();

  assert.deepEqual(
    mergeReviewRunObservabilityMetadata(
      {
        model_failure_class: "timeout",
        dispatch_source: "automation_dispatch_events",
      },
      {
        model_effective_timeout_ms: 300_000,
        dispatch_source: "job_runs",
        job_scope: "review",
      }
    ),
    {
      model_failure_class: "timeout",
      model_effective_timeout_ms: 300_000,
      dispatch_source: "job_runs",
      job_scope: "review",
    }
  );
});

test("buildReviewRunObservabilitySamples fails when a failed dispatch event has no linked job run", async () => {
  const { buildReviewRunObservabilitySamples } = await loadProductionSmoke();

  assert.throws(
    () =>
      buildReviewRunObservabilitySamples(
        [
          {
            job_run_id: "job-1",
            metadata: { model_failure_class: "timeout" },
          },
        ],
        new Map()
      ),
    /missing linked job_runs/
  );
});

test("buildReviewRunObservabilitySamples merges dispatch and job metadata for matched rows", async () => {
  const { buildReviewRunObservabilitySamples } = await loadProductionSmoke();

  assert.deepEqual(
    buildReviewRunObservabilitySamples(
      [
        {
          job_run_id: "job-1",
          metadata: { model_failure_class: "timeout" },
        },
      ],
      new Map([
        [
          "job-1",
          {
            id: "job-1",
            status: "failed",
            cost_usd: 0.0184,
            error: "Automation model request timed out",
            metadata: { model_effective_timeout_ms: 300_000 },
          },
        ],
      ])
    ),
    [
      {
        jobRunId: "job-1",
        status: "failed",
        error: "Automation model request timed out",
        costUsd: 0.0184,
        metadata: {
          model_failure_class: "timeout",
          model_effective_timeout_ms: 300_000,
        },
      },
    ]
  );
});
