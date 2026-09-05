import { expect, test } from "@playwright/test";
import type { ObservabilityJob } from "@/lib/types";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import { emptyAutomationFailuresResponse } from "./helpers/activation-fixtures";
import {
  fulfillJson,
  mockBaseChrome,
  modelId,
} from "./helpers/automation-control-plane-fixtures";

test("observability centers runtime runs and exposes repair/requeue actions", async ({
  page,
}) => {
  let repairCount = 0;
  let requeueCount = 0;
  let cancelCount = 0;
  const jobRequests: URL[] = [];
  const callRequests: URL[] = [];
  let jobs: ObservabilityJob[] = [];

  await enableScopedE2EAuth(page);
  await mockBaseChrome(page);

  await page.route("**/api/observability/stats*", (route) =>
    fulfillJson(route, {
      summary: {
        total_calls: 4,
        total_tokens: 12000,
        total_cost: 0.32,
        cost_today: 0.08,
        reconciliation_pending: 0,
        avg_duration_ms: 1820,
        success_rate: 75,
        calls_today: 2,
        tokens_today: 4000,
        sandbox_time_ms: 600000,
        sandbox_active: 1,
        sandbox_total: 2,
        job_runs_total: 3,
        job_runs_running: 1,
        job_runs_pending: 1,
        job_runs_stale_pending: 1,
        job_runs_failed_in_range: 1,
        job_runs_repaired_in_range: 1,
        job_runs_concluded_in_range: 3,
        job_runs_success_rate_in_range: 66.7,
        suppressed_in_range: 2,
        deferred_in_range: 1,
        start_failed_in_range: 1,
        limit_allowed_in_range: 0,
        limit_denied_in_range: 0,
        oldest_pending_age_ms: 420000,
      },
      by_model: [],
      by_type: [],
    })
  );

  await page.route("**/api/observability/jobs?*", async (route) => {
    jobRequests.push(new URL(route.request().url()));
    const payload = {
      jobs: [
        {
          id: "job-failed",
          assignment_id: "assignment-1",
          trigger_id: null,
          workflow_run_id: "wf_failed",
          retry_of_job_run_id: null,
          status: "failed",
          created_at: "2026-03-21T19:00:00.000Z",
          started_at: "2026-03-21T19:00:10.000Z",
          completed_at: "2026-03-21T19:01:00.000Z",
          input_tokens: 100,
          output_tokens: 200,
          duration_ms: 50000,
          cost_usd: null,
          error:
            "This Mogplex account cannot use hosted AI because it has no credit. Add funds or choose a plan in Settings > Billing. Or add an AI Gateway or provider key in Settings > API Keys.",
          start_attempts: 1,
          last_start_attempt_at: "2026-03-21T19:00:00.000Z",
          last_start_error: null,
          last_start_source: "cron",
          metadata: { repo_full_name: "acme/demo-app" },
          source_kind: "assignment",
          source_type: "cron_refactor",
          repo: { id: "repo-1", full_name: "acme/demo-app" },
          agent: { id: "agent-1", name: "Refactor Bot", slug: "refactor-bot" },
          latest_dispatch_event: {
            id: "dispatch-failed",
            event_kind: "control",
            outcome: "failed",
            reason: "START_RUNTIME_FAILED",
            metadata: null,
            created_at: "2026-03-21T19:01:00.000Z",
          },
          latest_ai_call: {
            id: "call-1",
            status: "failed",
            model: modelId,
            total_tokens: 300,
            tool_calls_count: 4,
            started_at: "2026-03-21T19:00:10.000Z",
          },
          cancel_requested_at: null,
          cancelled_at: null,
          cancel_reason: null,
          cancel_error: null,
          cancelable: false,
          repairable: false,
          requeueable: true,
        },
        {
          id: "job-pending",
          assignment_id: null,
          trigger_id: "trigger-1",
          workflow_run_id: null,
          retry_of_job_run_id: null,
          status: "pending",
          created_at: "2026-03-21T18:00:00.000Z",
          started_at: null,
          completed_at: null,
          input_tokens: null,
          output_tokens: null,
          duration_ms: null,
          cost_usd: null,
          error: null,
          start_attempts: 2,
          last_start_attempt_at: "2026-03-21T18:05:00.000Z",
          last_start_error: "workflow unavailable",
          last_start_source: "repair",
          metadata: { repo_full_name: "acme/demo-app" },
          source_kind: "trigger",
          source_type: "mention",
          repo: { id: "repo-1", full_name: "acme/demo-app" },
          agent: { id: "agent-2", name: "Mention Bot", slug: "mention-bot" },
          latest_ai_call: null,
          latest_dispatch_event: {
            id: "dispatch-pending",
            event_kind: "start",
            outcome: "deferred",
            reason: "REPO_CONCURRENCY_LIMIT",
            metadata: { start_source: "repair" },
            created_at: "2026-03-21T18:05:00.000Z",
          },
          cancel_requested_at: null,
          cancelled_at: null,
          cancel_reason: null,
          cancel_error: null,
          cancelable: true,
          repairable: true,
          requeueable: false,
        },
        {
          id: "job-review-no-findings",
          assignment_id: "assignment-2",
          trigger_id: null,
          workflow_run_id: "wf_review",
          retry_of_job_run_id: null,
          status: "success",
          created_at: "2026-03-21T17:00:00.000Z",
          started_at: "2026-03-21T17:00:05.000Z",
          completed_at: "2026-03-21T17:00:40.000Z",
          input_tokens: 50,
          output_tokens: 60,
          duration_ms: 35000,
          cost_usd: null,
          error: null,
          start_attempts: 1,
          last_start_attempt_at: "2026-03-21T17:00:00.000Z",
          last_start_error: null,
          last_start_source: "webhook",
          metadata: { repo_full_name: "acme/demo-app" },
          source_kind: "assignment",
          source_type: "pr_review",
          repo: { id: "repo-1", full_name: "acme/demo-app" },
          agent: { id: "agent-3", name: "Reviewer Bot", slug: "reviewer-bot" },
          latest_dispatch_event: {
            id: "dispatch-review",
            event_kind: "control",
            outcome: "completed",
            reason: "PR_REVIEW_NO_FINDINGS",
            metadata: {
              review_outcome: "PR_REVIEW_NO_FINDINGS",
              review_outcome_label: "No findings",
            },
            created_at: "2026-03-21T17:00:40.000Z",
          },
          latest_ai_call: null,
          cancel_requested_at: null,
          cancelled_at: null,
          cancel_reason: null,
          cancel_error: null,
          cancelable: false,
          repairable: false,
          requeueable: false,
        },
      ] satisfies ObservabilityJob[],
      total: 30,
      page: Number(new URL(route.request().url()).searchParams.get("page")),
      limit: 25,
    };
    jobs = payload.jobs;
    await fulfillJson(route, payload);
  });

  await page.route(/\/api\/observability\/jobs\/[^/?]+(?:\?.*)?$/, (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-1);
    const job = jobs.find((candidate) => candidate.id === id);
    return fulfillJson(route, {
      run: job
        ? {
            ...job,
            dispatch_events: job.latest_dispatch_event
              ? [job.latest_dispatch_event]
              : [],
            ai_calls: [],
            review_findings: [],
          }
        : null,
    });
  });

  await page.route("**/api/observability/calls?*", (route) => {
    callRequests.push(new URL(route.request().url()));
    return fulfillJson(route, {
      calls: [
        {
          id: "call-live",
          user_id: "user-1",
          type: "chat",
          model: modelId,
          input_tokens: null,
          output_tokens: null,
          total_tokens: null,
          duration_ms: null,
          started_at: "2026-03-21T19:10:00.000Z",
          completed_at: null,
          status: "streaming",
          error: null,
          conversation_id: "conversation-1",
          job_run_id: null,
          repo_id: "repo-1",
          runtime_command_id: null,
          tool_calls_count: 0,
          tool_calls: [],
          metadata: { repo: "acme/demo-app" },
        },
        {
          id: "call-1",
          user_id: "user-1",
          type: "cron_refactor",
          model: modelId,
          input_tokens: 100,
          output_tokens: 200,
          total_tokens: 300,
          duration_ms: 50000,
          started_at: "2026-03-21T19:00:10.000Z",
          completed_at: "2026-03-21T19:01:00.000Z",
          status: "failed",
          error: "lint failed",
          conversation_id: null,
          job_run_id: "job-failed",
          repo_id: "repo-1",
          runtime_command_id: null,
          tool_calls_count: 4,
          tool_calls: [],
          metadata: { repo: "acme/demo-app" },
        },
      ],
      total: 75,
      page: Number(new URL(route.request().url()).searchParams.get("page")),
      limit: 50,
    });
  });
  await page.route("**/api/observability/automation-events?*", (route) =>
    fulfillJson(route, {
      events: [
        {
          id: "event-1",
          job_run_id: "job-pending",
          assignment_id: null,
          trigger_id: "trigger-1",
          repo_id: "repo-1",
          installation_id: 101,
          source_kind: "trigger",
          source_type: "mention",
          event_kind: "start",
          outcome: "deferred",
          reason: "REPO_CONCURRENCY_LIMIT",
          metadata: { start_source: "repair" },
          created_at: "2026-03-21T18:05:00.000Z",
          repo: { id: "repo-1", full_name: "acme/demo-app" },
          agent: { id: "agent-2", name: "Mention Bot", slug: "mention-bot" },
        },
      ],
      total: 1,
      page: 1,
      limit: 25,
    })
  );
  await page.route(
    /\/api\/observability\/automation-failures(?:\?.*)?$/,
    (route) => fulfillJson(route, emptyAutomationFailuresResponse)
  );

  await page.route(
    "**/api/observability/jobs/job-pending/repair",
    async (route) => {
      repairCount += 1;
      await fulfillJson(route, {
        ok: true,
        started: true,
        status: "pending",
        runtimeProvider: "workflow",
        runtimeRunId: "wf_repair",
        workflowRunId: "wf_repair",
      });
    }
  );

  await page.route(
    "**/api/observability/jobs/job-pending/cancel",
    async (route) => {
      cancelCount += 1;
      await fulfillJson(
        route,
        { error: "Job run is no longer cancelable" },
        409
      );
    }
  );

  await page.route(
    "**/api/observability/jobs/job-failed/requeue",
    async (route) => {
      requeueCount += 1;
      await fulfillJson(route, {
        ok: true,
        started: true,
        status: "pending",
        runtimeProvider: "workflow",
        runtimeRunId: "wf_retry",
        workflowRunId: "wf_retry",
        jobRunId: "job-retry",
      });
    }
  );

  await page.goto(scopedPath("observability"));
  await page.waitForLoadState("networkidle");

  await expect(
    page.getByRole("heading", { name: "Automation health" })
  ).toBeVisible();
  await expect(
    page.getByLabel("Automation health").getByText("Needs attention")
  ).toBeVisible();
  await expect(page.getByText("Run success")).toBeVisible();
  await expect(page.getByText("66.7%", { exact: true })).toBeVisible();
  await expect(page.getByText("Operational signals")).toBeVisible();
  await expect(page.getByText("Prevented", { exact: true })).toBeVisible();
  await expect(page.getByText("2 events not run")).toBeVisible();
  await expect(page.getByText("1 start attempt retried")).toBeVisible();
  await expect(page.getByText("1 failed start attempt")).toBeVisible();
  await expect(page.getByText("Action required")).toBeVisible();
  await expect(page.getByText("1 run remains failed")).toBeVisible();
  await expect(page.getByText("1 pending run needs recovery")).toBeVisible();

  const recoveryRequestPromise = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return (
      url.pathname === "/api/observability/jobs" &&
      url.searchParams.get("status") === "pending" &&
      url.searchParams.get("only_repairable") === "true"
    );
  });
  await page.getByText("1 pending run needs recovery").click();
  const recoveryRequest = new URL((await recoveryRequestPromise).url());
  expect(recoveryRequest.searchParams.get("from")).toBeNull();
  expect(recoveryRequest.searchParams.get("to")).toBeNull();
  await expect(
    page.getByText("Current active work across all dates.")
  ).toBeVisible();

  const pendingRequestPromise = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return (
      url.pathname === "/api/observability/jobs" &&
      url.searchParams.get("status") === "pending" &&
      !url.searchParams.has("only_repairable")
    );
  });
  await page.getByRole("button", { name: "Inspect 1 pending run" }).click();
  const pendingRequest = new URL((await pendingRequestPromise).url());
  expect(pendingRequest.searchParams.get("from")).toBeNull();
  expect(pendingRequest.searchParams.get("to")).toBeNull();

  await page
    .getByRole("button", { name: "Inspect 2 prevented events" })
    .click();
  // The prevented-events drill-down switches the table tab group to the
  // Pressure tab with the outcome filter applied.
  await expect(
    page.getByRole("tab", { name: /^Automation events/ })
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("Outcome")).toHaveValue("suppressed");
  await page.getByRole("tab", { name: /^Runs/ }).click();
  await expect(page.getByLabel("Run status")).toBeVisible();
  await page.getByRole("button", { name: "Refactor Bot", exact: true }).click();
  const inspector = page.getByRole("region", {
    name: "Run details",
    exact: true,
  });
  await expect(
    page.getByText(
      "This Mogplex account cannot use hosted AI because it has no credit. Add funds or choose a plan in Settings > Billing. Or add an AI Gateway or provider key in Settings > API Keys."
    )
  ).toBeVisible();
  await expect(
    inspector.getByRole("button", { name: "Retry as new run", exact: true })
  ).toBeVisible();
  await inspector
    .getByRole("button", { name: "Retry as new run", exact: true })
    .click();
  await inspector
    .getByRole("button", { name: "Confirm retry as new run" })
    .click();
  await expect.poll(() => requeueCount).toBe(1);
  await inspector.getByRole("button", { name: "Back to runs" }).click();
  await page.getByRole("button", { name: "Mention Bot", exact: true }).click();
  await expect(
    inspector.getByText("Repository run limit reached")
  ).toBeVisible();
  await inspector
    .getByRole("button", { name: "Cancel run", exact: true })
    .click();
  await inspector.getByRole("button", { name: "Confirm cancel run" }).click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Job run is no longer cancelable" })
  ).toBeVisible();
  await inspector
    .getByRole("button", { name: "Repair run", exact: true })
    .click();
  await inspector.getByRole("button", { name: "Confirm repair run" }).click();
  await expect.poll(() => repairCount).toBe(1);
  await inspector.getByRole("button", { name: "Back to runs" }).click();
  await page.getByRole("button", { name: "Reviewer Bot", exact: true }).click();
  await expect(
    inspector.getByText(
      "The review completed with no findings. This does not mean the PR has been merged."
    )
  ).toBeVisible();
  await inspector.getByRole("button", { name: "Back to runs" }).click();

  expect(cancelCount).toBe(1);
  expect(repairCount).toBe(1);
  expect(requeueCount).toBe(1);

  // Only the active tab's panel is mounted, so getByRole("tabpanel") always
  // resolves to the table currently shown.
  const activePanel = page.getByRole("tabpanel");
  await activePanel.getByRole("button", { name: "Next" }).click();
  await expect(activePanel.getByText("Showing 26–30 of 30")).toBeVisible();
  await page.getByRole("tab", { name: /^Usage/ }).click();
  await activePanel.getByRole("button", { name: "Next" }).click();
  await expect(activePanel.getByText("Showing 51–75 of 75")).toBeVisible();

  await page.getByRole("tab", { name: /^Runs/ }).click();
  await page.getByLabel("Run status").selectOption("");

  const previousJobsFrom = jobRequests.at(-1)?.searchParams.get("from");
  const previousCallsFrom = callRequests.at(-1)?.searchParams.get("from");
  expect(previousCallsFrom).toBe(callRequests[0]?.searchParams.get("from"));
  const changedJobsRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return (
      url.pathname === "/api/observability/jobs" &&
      url.searchParams.get("from") !== previousJobsFrom
    );
  });
  const changedCallsRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return (
      url.pathname === "/api/observability/calls" &&
      url.searchParams.get("from") !== previousCallsFrom
    );
  });

  await page.getByLabel("Date range").selectOption("today");
  const [jobsRequest, callsRequest] = await Promise.all([
    changedJobsRequest,
    changedCallsRequest,
  ]);
  expect(new URL(jobsRequest.url()).searchParams.get("page")).toBe("1");
  expect(new URL(callsRequest.url()).searchParams.get("page")).toBe("1");
});
