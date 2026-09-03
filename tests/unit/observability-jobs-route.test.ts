import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import type { ObservabilityJob } from "../../lib/types";

async function loadObservabilityJobsRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/observability/jobs/route");
}

function makeAgentRunJob(
  id: string,
  createdAt: string,
  aiCallId: string
): ObservabilityJob {
  return {
    id,
    assignment_id: null,
    trigger_id: null,
    flow_id: null,
    flow_version_id: null,
    runtime_provider: "trigger",
    runtime_run_id: null,
    workflow_run_id: null,
    retry_of_job_run_id: null,
    status: "success",
    created_at: createdAt,
    started_at: createdAt,
    completed_at: createdAt,
    input_tokens: null,
    output_tokens: null,
    cost_usd: null,
    duration_ms: null,
    error: null,
    start_attempts: 1,
    last_start_attempt_at: createdAt,
    last_start_error: null,
    last_start_source: null,
    cancel_requested_at: null,
    cancelled_at: null,
    cancel_reason: null,
    cancel_error: null,
    metadata: { ai_call_id: aiCallId },
    source_kind: "agent_run",
    source_type: "api",
    repo: { id: "repo-1", full_name: "Mogplex/mogplex" },
    agent: { id: null, name: "claude-code", slug: null },
    latest_ai_call: null,
    latest_dispatch_event: null,
    repairable: false,
    requeueable: false,
    cancelable: false,
  };
}

// Call durations deliberately disagree with creation order so a page built
// before the calls are attached would pick the wrong rows.
const durationsByCallId: Record<string, number> = {
  "call-a": 100,
  "call-b": 300,
  "call-c": 200,
};

function buildHandler(attachCalls: ObservabilityJob[][]) {
  return async () => {
    const { createObservabilityJobsGetHandler } =
      await loadObservabilityJobsRoute();
    return createObservabilityJobsGetHandler({
      requireUserId: async () => "user-1",
      loadUserJobRuns: async () => ({ scope: {} as never, runs: [] }),
      loadUserAgentRunJobs: async () => [
        makeAgentRunJob("run-a", "2026-09-03T10:00:00Z", "call-a"),
        makeAgentRunJob("run-b", "2026-09-03T09:00:00Z", "call-b"),
        makeAgentRunJob("run-c", "2026-09-03T08:00:00Z", "call-c"),
      ],
      attachAgentRunAiCalls: async (jobs) => {
        attachCalls.push([...jobs]);
        for (const job of jobs) {
          const aiCallId = String(job.metadata?.ai_call_id);
          job.duration_ms = durationsByCallId[aiCallId];
        }
      },
      loadJobPageDetails: async () => ({ aiCalls: [], dispatchEvents: [] }),
    });
  };
}

test("GET /api/observability/jobs attaches agent-run calls before paginating by duration", async () => {
  const attachCalls: ObservabilityJob[][] = [];
  const handler = await buildHandler(attachCalls)();

  const response = await handler(
    new NextRequest(
      "http://localhost/api/observability/jobs?sort=duration_ms&order=desc&limit=2"
    )
  );
  const body = (await response.json()) as {
    jobs: ObservabilityJob[];
    total: number;
  };

  assert.equal(response.status, 200);
  assert.equal(body.total, 3);
  assert.deepEqual(
    body.jobs.map((job) => [job.id, job.duration_ms]),
    [
      ["run-b", 300],
      ["run-c", 200],
    ]
  );
  assert.equal(attachCalls.length, 1);
  assert.equal(attachCalls[0].length, 3);
});

test("GET /api/observability/jobs enriches only the returned page for row-backed sorts", async () => {
  const attachCalls: ObservabilityJob[][] = [];
  const handler = await buildHandler(attachCalls)();

  const response = await handler(
    new NextRequest(
      "http://localhost/api/observability/jobs?sort=created_at&order=desc&limit=2"
    )
  );
  const body = (await response.json()) as { jobs: ObservabilityJob[] };

  assert.equal(response.status, 200);
  assert.deepEqual(
    body.jobs.map((job) => [job.id, job.duration_ms]),
    [
      ["run-a", 100],
      ["run-b", 300],
    ]
  );
  assert.equal(attachCalls.length, 1);
  assert.deepEqual(
    attachCalls[0].map((job) => job.id),
    ["run-a", "run-b"]
  );
});
