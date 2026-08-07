import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import { emptyAutomationFailuresResponse } from "./helpers/activation-fixtures";
import {
  fulfillJson,
  mockBaseChrome,
  modelId,
} from "./helpers/automation-control-plane-fixtures";

test("recovered delays remain healthy and require no action", async ({
  page,
}) => {
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
        success_rate: 100,
        calls_today: 2,
        tokens_today: 4000,
        sandbox_time_ms: 600000,
        sandbox_active: 0,
        sandbox_total: 2,
        job_runs_total: 7626,
        job_runs_running: 0,
        job_runs_pending: 0,
        job_runs_stale_pending: 0,
        job_runs_failed_in_range: 0,
        job_runs_repaired_in_range: 19,
        job_runs_concluded_in_range: 804,
        job_runs_success_rate_in_range: 100,
        suppressed_in_range: 5,
        deferred_in_range: 3,
        start_failed_in_range: 2,
        limit_allowed_in_range: 0,
        limit_denied_in_range: 0,
        oldest_pending_age_ms: 0,
      },
      by_model: [],
      by_type: [],
    })
  );
  await page.route("**/api/observability/jobs?*", (route) =>
    fulfillJson(route, { jobs: [], total: 0, page: 1, limit: 25 })
  );
  await page.route("**/api/observability/calls?*", (route) =>
    fulfillJson(route, { calls: [], total: 0, page: 1, limit: 50 })
  );
  await page.route("**/api/observability/automation-events?*", (route) =>
    fulfillJson(route, { events: [], total: 0, page: 1, limit: 25 })
  );
  await page.route(
    /\/api\/observability\/automation-failures(?:\?.*)?$/,
    (route) => fulfillJson(route, emptyAutomationFailuresResponse)
  );

  await page.goto(scopedPath("observability"));
  await page.waitForLoadState("networkidle");

  await expect(page.getByText("Healthy", { exact: true })).toBeVisible();
  await expect(page.getByText("Recent pressure", { exact: true })).toHaveCount(
    0
  );
  await expect(page.getByText("No action needed")).toBeVisible();
  await expect(page.getByText("Start failures", { exact: true })).toBeVisible();
  await expect(page.getByText("2 failed start attempts")).toBeVisible();
  await expect(
    page.getByText(
      "3 delayed start attempts retried automatically; no failed or stale runs need attention."
    )
  ).toBeVisible();
});

test("assignments show last run health inline and triggers surface loads", async ({
  page,
}) => {
  let requeueCount = 0;

  await enableScopedE2EAuth(page);
  await mockBaseChrome(page);

  await page.route("**/api/repos", (route) =>
    fulfillJson(route, [{ id: "repo-1", full_name: "acme/demo-app" }])
  );
  await page.route("**/api/agents", (route) =>
    fulfillJson(route, [
      {
        id: "agent-1",
        name: "Refactor Bot",
        slug: "refactor-bot",
        model: modelId,
      },
    ])
  );
  await page.route("**/api/github/installations", (route) =>
    fulfillJson(route, [])
  );
  await page.route("**/api/assignments", (route) =>
    fulfillJson(route, [
      {
        id: "assignment-1",
        repo_id: "repo-1",
        agent_id: "agent-1",
        type: "cron_refactor",
        cron_schedule: "0 * * * *",
        skill_id: null,
        enabled: true,
        created_at: "2026-03-20T10:00:00.000Z",
        last_job_run_id: "job-failed",
        last_run_status: "failed",
        last_run_started_at: "2026-03-21T19:00:10.000Z",
        last_run_error: "lint failed",
        running_count: 0,
        pending_count: 1,
        failed_24h: 1,
        suppressed_24h: 2,
        deferred_24h: 1,
        start_failed_24h: 0,
        last_pressure_reason: "REPO_PENDING_LIMIT",
        last_pressure_at: "2026-03-21T19:05:00.000Z",
        last_run_repairable: false,
        last_run_requeueable: true,
      },
    ])
  );
  await page.route("**/api/triggers", (route) => fulfillJson(route, []));
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

  await page.goto(scopedPath("assignments"));
  await page.waitForLoadState("networkidle");

  await expect(page.getByText("Last run: failed")).toBeVisible();
  await expect(page.getByRole("button", { name: "Requeue" })).toBeVisible();
  await page.getByRole("button", { name: "Requeue" }).click();
  expect(requeueCount).toBe(1);

  await page.goto(scopedPath("triggers"));
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("triggers-empty-state")).toBeVisible();
});
