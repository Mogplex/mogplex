import { expect, test } from "@playwright/test";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import { emptyAutomationFailuresResponse } from "./helpers/activation-fixtures";
import {
  connectedUser,
  fulfillJson,
  mockBaseApp,
  modelId,
  repo,
} from "./helpers/diff-rendering-fixtures";

test("observability renders nested tool output diffs with the shared viewer", async ({
  page,
}) => {
  const now = new Date().toISOString();
  const patch = [
    "diff --git a/src/agent.ts b/src/agent.ts",
    "index 1111111..2222222 100644",
    "--- a/src/agent.ts",
    "+++ b/src/agent.ts",
    "@@ -1 +1 @@",
    "-export const mode = 'idle'",
    "+export const mode = 'ready'",
    "",
  ].join("\n");

  // Register the base mocks FIRST: Playwright matches routes in reverse
  // registration order (last registered wins), so the observability-specific
  // mocks below must come after mockBaseApp's empty-calls defaults.
  await enableScopedE2EAuth(page);
  await mockBaseApp(page);

  await page.route("**/api/observability/calls*", (route) =>
    fulfillJson(route, {
      calls: [
        {
          id: "call-1",
          user_id: connectedUser.id,
          type: "chat",
          model: modelId,
          input_tokens: 10,
          output_tokens: 12,
          total_tokens: 22,
          duration_ms: 1200,
          started_at: now,
          completed_at: now,
          status: "success",
          error: null,
          conversation_id: "conversation-1",
          job_run_id: null,
          repo_id: repo.id,
          tool_calls_count: 1,
          tool_calls: [
            {
              name: "git_diff",
              input_preview: '{"repo":"acme/demo-app"}',
              input: { repo: repo.full_name },
              output_preview: "diff --git a/src/agent.ts b/src/agent.ts",
              output: { stdout: patch },
              duration_ms: 75,
            },
          ],
          metadata: { repo: repo.full_name },
        },
      ],
      total: 1,
      page: 1,
      limit: 20,
    })
  );
  await page.route(/\/api\/observability\/call-events(?:\?.*)?$/, (route) =>
    fulfillJson(route, { events: [] })
  );
  await page.route("**/api/observability/stats*", (route) =>
    fulfillJson(route, {
      summary: {
        total_calls: 1,
        total_tokens: 22,
        total_cost: 0,
        cost_today: 0,
        reconciliation_pending: 0,
        avg_duration_ms: 1200,
        success_rate: 1,
        calls_today: 1,
        tokens_today: 22,
        sandbox_time_ms: 0,
        sandbox_active: 0,
        sandbox_total: 0,
        job_runs_total: 0,
        job_runs_running: 0,
        job_runs_pending: 0,
        job_runs_stale_pending: 0,
        job_runs_failed_in_range: 0,
        job_runs_repaired_in_range: 0,
        job_runs_success_rate_in_range: 0,
        suppressed_in_range: 0,
        deferred_in_range: 0,
        start_failed_in_range: 0,
        limit_allowed_in_range: 0,
        limit_denied_in_range: 0,
        oldest_pending_age_ms: 0,
      },
      by_model: [],
      by_type: [],
    })
  );
  await page.route(
    /\/api\/observability\/automation-events(?:\?.*)?$/,
    (route) =>
      fulfillJson(route, {
        events: [],
        total: 0,
        page: 1,
        limit: 25,
      })
  );
  await page.route(
    /\/api\/observability\/automation-failures(?:\?.*)?$/,
    (route) => fulfillJson(route, emptyAutomationFailuresResponse)
  );
  await page.route(/\/api\/observability\/jobs(?:\?.*)?$/, (route) =>
    fulfillJson(route, {
      jobs: [],
      total: 0,
      page: 1,
      limit: 25,
    })
  );

  // Expand the call row via the call_id query param instead of clicking the
  // row: the row-toggle handler navigates through buildObservabilityHref's
  // unscoped "/observability?..." href, which only works in production because
  // proxy.ts rescue-redirects it back into the scope — the e2e bypass skips
  // that rescue, so a click would strand the test on a bogus
  // "/observability" scope.
  await page.goto(scopedPath("observability?call_id=call-1"));
  await page.waitForLoadState("networkidle");

  await expect(
    page.getByRole("heading", { name: "Observability", level: 1 })
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Activity" })).toBeVisible();
  await expect(page.getByRole("row", { name: /minimax-m2\.5/i })).toBeVisible();

  await expect(page.getByText("Diff source: stdout")).toBeVisible();
  await expect(page.getByText("src/agent.ts")).toBeVisible();
  await expect(page.getByText("export const mode = 'ready'")).toBeVisible();
});
