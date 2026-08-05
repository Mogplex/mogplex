import assert from "node:assert/strict";
import test from "node:test";

async function loadObservabilityJobDetailRoute() {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
  return import("../../app/api/observability/jobs/[id]/route");
}

test("GET /api/observability/jobs/[id] returns 404 for missing owned runs", async () => {
  const { createObservabilityJobDetailGetHandler } =
    await loadObservabilityJobDetailRoute();

  const handler = createObservabilityJobDetailGetHandler({
    requireUserId: async () => "user-1",
    loadOwnedJobRunDetail: async () => ({ scope: {} as never, run: null }),
  });

  const response = await handler(
    new Request("http://localhost/api/observability/jobs/job-1") as never,
    { params: Promise.resolve({ id: "job-1" }) }
  );

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "Job run not found" });
});

test("GET /api/observability/jobs/[id] returns review findings with job detail", async () => {
  const { createObservabilityJobDetailGetHandler } =
    await loadObservabilityJobDetailRoute();

  const handler = createObservabilityJobDetailGetHandler({
    requireUserId: async () => "user-1",
    loadOwnedJobRunDetail: async () => ({
      scope: {} as never,
      run: {
        id: "job-1",
        status: "success",
        source_kind: "assignment",
        source_type: "pr_review",
        repo: {
          id: "repo-1",
          full_name: "acme/widgets",
        },
        agent: {
          id: "agent-1",
          name: "PR Reviewer",
          slug: "pr-reviewer",
        },
        latest_ai_call: null,
        latest_dispatch_event: null,
        repairable: false,
        requeueable: false,
        cancelable: false,
        assignment_id: "assignment-1",
        trigger_id: null,
        flow_id: null,
        flow_version_id: null,
        runtime_provider: "trigger",
        runtime_run_id: "run_123",
        workflow_run_id: null,
        retry_of_job_run_id: null,
        created_at: "2026-04-12T10:00:00.000Z",
        started_at: "2026-04-12T10:00:01.000Z",
        completed_at: "2026-04-12T10:00:05.000Z",
        input_tokens: 10,
        output_tokens: 12,
        duration_ms: 4000,
        error: null,
        start_attempts: 1,
        last_start_attempt_at: null,
        last_start_error: null,
        last_start_source: "webhook",
        cancel_requested_at: null,
        cancelled_at: null,
        cancel_reason: null,
        cancel_error: null,
        metadata: { pr_number: 42 },
        dispatch_events: [],
        ai_calls: [],
        review_findings: [
          {
            id: "finding-1",
            user_id: "user-1",
            job_run_id: "job-1",
            repo_id: "repo-1",
            repo_full_name: "acme/widgets",
            pr_number: 42,
            head_sha: "abc123",
            ordinal: 0,
            fingerprint: "fingerprint-1",
            severity: "warning",
            title: "Guard nullable lookup",
            body: "The widget lookup can be null here.",
            path: "src/widget.ts",
            line: 18,
            status: "open",
            issue_number: null,
            issue_url: null,
            dismissed_at: null,
            created_at: "2026-04-12T10:00:05.000Z",
            updated_at: "2026-04-12T10:00:05.000Z",
          },
        ],
      } as never,
    }),
  });

  const response = await handler(
    new Request("http://localhost/api/observability/jobs/job-1") as never,
    { params: Promise.resolve({ id: "job-1" }) }
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.run.id, "job-1");
  assert.deepEqual(payload.run.review_findings, [
    {
      id: "finding-1",
      user_id: "user-1",
      job_run_id: "job-1",
      repo_id: "repo-1",
      repo_full_name: "acme/widgets",
      pr_number: 42,
      head_sha: "abc123",
      ordinal: 0,
      fingerprint: "fingerprint-1",
      severity: "warning",
      title: "Guard nullable lookup",
      body: "The widget lookup can be null here.",
      path: "src/widget.ts",
      line: 18,
      status: "open",
      issue_number: null,
      issue_url: null,
      dismissed_at: null,
      created_at: "2026-04-12T10:00:05.000Z",
      updated_at: "2026-04-12T10:00:05.000Z",
    },
  ]);
});

test("GET /api/observability/jobs/[id] never returns raw loader errors", async (t) => {
  const { createObservabilityJobDetailGetHandler } =
    await loadObservabilityJobDetailRoute();
  t.mock.method(console, "error", () => {});
  const handler = createObservabilityJobDetailGetHandler({
    requireUserId: async () => "user-1",
    loadOwnedJobRunDetail: async () => {
      throw new Error("DATABASE_URL is required at postgres://internal");
    },
  });

  const response = await handler(
    new Request("http://localhost/api/observability/jobs/job-secret") as never,
    { params: Promise.resolve({ id: "job-secret" }) }
  );
  const payload = await response.json();

  assert.equal(response.status, 500);
  assert.equal(JSON.stringify(payload).includes("DATABASE_URL"), false);
  assert.match(payload.error, /MOG-JOB-JOBSECRET/);
});
