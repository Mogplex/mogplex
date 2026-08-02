import assert from "node:assert/strict";
import test from "node:test";
import type { JobRunRow, UserAutomationScope } from "../../lib/job-run-service";

process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";

async function loadJobRunServiceModule() {
  return import("../../lib/job-run-service");
}

function makeRun(overrides: Partial<JobRunRow> & Pick<JobRunRow, "id">) {
  return {
    assignment_id: null,
    trigger_id: null,
    flow_id: null,
    flow_version_id: null,
    runtime_provider: null,
    runtime_run_id: null,
    workflow_run_id: null,
    retry_of_job_run_id: null,
    status: "success",
    created_at: "2026-06-01T00:00:00.000Z",
    started_at: null,
    completed_at: null,
    input_tokens: null,
    output_tokens: null,
    cost_usd: null,
    duration_ms: null,
    error: null,
    start_attempts: 0,
    last_start_attempt_at: null,
    last_start_error: null,
    last_start_source: null,
    cancel_requested_at: null,
    cancelled_at: null,
    cancel_reason: null,
    cancel_error: null,
    metadata: null,
    ...overrides,
  } satisfies JobRunRow;
}

test("collectPagedRows pages past the server cap until a short page", async () => {
  const { collectPagedRows } = await loadJobRunServiceModule();

  // 2,150 rows behind a 1,000-row server cap: three reads (1000, 1000, 150).
  const total = 2150;
  const requested: Array<{ offset: number; limit: number }> = [];
  const rows = await collectPagedRows(
    async (offset, limit) => {
      requested.push({ offset, limit });
      const remaining = Math.max(0, total - offset);
      const count = Math.min(limit, remaining);
      return Array.from({ length: count }, (_, i) =>
        makeRun({ id: `run-${offset + i}` })
      );
    },
    { pageSize: 1000, maxRows: 10000 }
  );

  assert.equal(rows.length, total);
  assert.deepEqual(requested, [
    { offset: 0, limit: 1000 },
    { offset: 1000, limit: 1000 },
    { offset: 2000, limit: 1000 },
  ]);
  // No further reads after the short (150-row) page.
  assert.equal(new Set(rows.map((r) => r.id)).size, total);
});

test("collectPagedRows stops at the safety cap when pages never run short", async () => {
  const { collectPagedRows } = await loadJobRunServiceModule();

  let calls = 0;
  const rows = await collectPagedRows(
    async (offset, limit) => {
      calls += 1;
      return Array.from({ length: limit }, (_, i) =>
        makeRun({ id: `run-${offset + i}` })
      );
    },
    { pageSize: 1000, maxRows: 3000 }
  );

  // Cap reached without a short page: exactly maxRows/pageSize reads, no runaway.
  assert.equal(calls, 3);
  assert.equal(rows.length, 3000);
});

test("mergeJobRunPages dedupes by id and sorts newest-first across scopes", async () => {
  const { mergeJobRunPages } = await loadJobRunServiceModule();

  // A run shared across two scope pages, plus out-of-order timestamps and a
  // created_at tie that must fall back to id for a stable global order.
  const shared = makeRun({
    id: "shared",
    created_at: "2026-06-10T00:00:00.000Z",
  });
  const merged = mergeJobRunPages([
    [shared, makeRun({ id: "older", created_at: "2026-06-01T00:00:00.000Z" })],
    [
      shared,
      makeRun({ id: "newest", created_at: "2026-06-20T00:00:00.000Z" }),
      makeRun({ id: "tie-b", created_at: "2026-06-15T00:00:00.000Z" }),
      makeRun({ id: "tie-a", created_at: "2026-06-15T00:00:00.000Z" }),
    ],
  ]);

  assert.deepEqual(
    merged.map((run) => run.id),
    ["newest", "tie-b", "tie-a", "shared", "older"]
  );
});

test("resolveFlowVersionAttribution keeps historical version metadata after a flow is republished", async () => {
  const { resolveFlowVersionAttribution } = await loadJobRunServiceModule();

  const scope = {
    reposById: new Map(),
    assignmentsById: new Map(),
    triggersById: new Map(),
    flowsById: new Map(),
    agentsById: new Map(),
    flowAttributionByVersionId: new Map([
      [
        "version-1",
        {
          flowId: "flow-1",
          primaryAgentId: "agent-a",
          agentIds: ["agent-a"],
          sourceType: "pr_opened",
        },
      ],
      [
        "version-2",
        {
          flowId: "flow-1",
          primaryAgentId: "agent-b",
          agentIds: ["agent-b"],
          sourceType: "issue_opened",
        },
      ],
    ]),
    currentFlowVersionIdByFlowId: new Map([["flow-1", "version-2"]]),
    assignmentIds: [],
    triggerIds: [],
    flowIds: ["flow-1"],
  } satisfies UserAutomationScope;

  const historical = resolveFlowVersionAttribution(scope, {
    flowId: "flow-1",
    flowVersionId: "version-1",
    metadata: null,
  });

  assert.deepEqual(historical, {
    flowId: "flow-1",
    primaryAgentId: "agent-a",
    agentIds: ["agent-a"],
    sourceType: "pr_opened",
  });
});

test("resolveFlowVersionAttribution falls back to the current published flow version for legacy rows", async () => {
  const { resolveFlowVersionAttribution } = await loadJobRunServiceModule();

  const scope = {
    reposById: new Map(),
    assignmentsById: new Map(),
    triggersById: new Map(),
    flowsById: new Map(),
    agentsById: new Map(),
    flowAttributionByVersionId: new Map([
      [
        "version-2",
        {
          flowId: "flow-1",
          primaryAgentId: "agent-b",
          agentIds: ["agent-b"],
          sourceType: "issue_opened",
        },
      ],
    ]),
    currentFlowVersionIdByFlowId: new Map([["flow-1", "version-2"]]),
    assignmentIds: [],
    triggerIds: [],
    flowIds: ["flow-1"],
  } satisfies UserAutomationScope;

  const attribution = resolveFlowVersionAttribution(scope, {
    flowId: "flow-1",
    flowVersionId: null,
    metadata: null,
  });

  assert.deepEqual(attribution, {
    flowId: "flow-1",
    primaryAgentId: "agent-b",
    agentIds: ["agent-b"],
    sourceType: "issue_opened",
  });
});

test("buildObservabilityJob preserves materialized job run cost", async () => {
  const { buildObservabilityJob } = await loadJobRunServiceModule();

  const scope = {
    reposById: new Map([
      [
        "repo-1",
        {
          id: "repo-1",
          full_name: "acme/widgets",
          user_id: "user-1",
          github_installation_id: 42,
        },
      ],
    ]),
    assignmentsById: new Map([
      [
        "assignment-1",
        {
          id: "assignment-1",
          repo_id: "repo-1",
          agent_id: "agent-1",
          type: "pr_review",
        },
      ],
    ]),
    triggersById: new Map(),
    flowsById: new Map(),
    agentsById: new Map([
      [
        "agent-1",
        {
          id: "agent-1",
          name: "Reviewer",
          slug: "reviewer",
          model: "openai/gpt-5.4",
        },
      ],
    ]),
    flowAttributionByVersionId: new Map(),
    currentFlowVersionIdByFlowId: new Map(),
    assignmentIds: ["assignment-1"],
    triggerIds: [],
    flowIds: [],
  } satisfies UserAutomationScope;

  const job = buildObservabilityJob(scope, {
    id: "job-1",
    assignment_id: "assignment-1",
    trigger_id: null,
    flow_id: null,
    flow_version_id: null,
    runtime_provider: "trigger",
    runtime_run_id: "run_123",
    workflow_run_id: null,
    retry_of_job_run_id: null,
    status: "failed",
    created_at: "2026-04-22T12:00:00.000Z",
    started_at: "2026-04-22T12:00:01.000Z",
    completed_at: "2026-04-22T12:05:00.000Z",
    input_tokens: 100,
    output_tokens: 200,
    cost_usd: 0.0184,
    duration_ms: 299_000,
    error: "AI provider timed out during PR review after 5m.",
    start_attempts: 1,
    last_start_attempt_at: null,
    last_start_error: null,
    last_start_source: "webhook",
    cancel_requested_at: null,
    cancelled_at: null,
    cancel_reason: null,
    cancel_error: null,
    metadata: { repo_full_name: "acme/widgets" },
  });

  assert.equal(job.cost_usd, 0.0184);
  assert.deepEqual(job.repo, {
    id: "repo-1",
    full_name: "acme/widgets",
  });
  assert.deepEqual(job.agent, {
    id: "agent-1",
    name: "Reviewer",
    slug: "reviewer",
  });
});

test("buildObservabilityJob coerces numeric-string job costs to finite numbers", async () => {
  const { buildObservabilityJob } = await loadJobRunServiceModule();

  const scope = {
    reposById: new Map([
      [
        "repo-1",
        {
          id: "repo-1",
          full_name: "acme/widgets",
          user_id: "user-1",
          github_installation_id: 42,
        },
      ],
    ]),
    assignmentsById: new Map([
      [
        "assignment-1",
        {
          id: "assignment-1",
          repo_id: "repo-1",
          agent_id: "agent-1",
          type: "pr_review",
        },
      ],
    ]),
    triggersById: new Map(),
    flowsById: new Map(),
    agentsById: new Map([
      [
        "agent-1",
        {
          id: "agent-1",
          name: "Reviewer",
          slug: "reviewer",
          model: "openai/gpt-5.4",
        },
      ],
    ]),
    flowAttributionByVersionId: new Map(),
    currentFlowVersionIdByFlowId: new Map(),
    assignmentIds: ["assignment-1"],
    triggerIds: [],
    flowIds: [],
  } satisfies UserAutomationScope;

  const job = buildObservabilityJob(scope, {
    id: "job-1",
    assignment_id: "assignment-1",
    trigger_id: null,
    flow_id: null,
    flow_version_id: null,
    runtime_provider: "trigger",
    runtime_run_id: "run_123",
    workflow_run_id: null,
    retry_of_job_run_id: null,
    status: "failed",
    created_at: "2026-04-22T12:00:00.000Z",
    started_at: "2026-04-22T12:00:01.000Z",
    completed_at: "2026-04-22T12:05:00.000Z",
    input_tokens: 100,
    output_tokens: 200,
    cost_usd: "0.0184",
    duration_ms: 299_000,
    error: "AI provider timed out during PR review after 5m.",
    start_attempts: 1,
    last_start_attempt_at: null,
    last_start_error: null,
    last_start_source: "webhook",
    cancel_requested_at: null,
    cancelled_at: null,
    cancel_reason: null,
    cancel_error: null,
    metadata: { repo_full_name: "acme/widgets" },
  });

  assert.equal(job.cost_usd, 0.0184);
});
