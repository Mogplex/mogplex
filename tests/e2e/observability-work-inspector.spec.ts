import { expect, test } from "@playwright/test";
import type { ObservabilityJobDetail } from "../../lib/types";
import { enableScopedE2EAuth, scopedPath } from "./helpers/auth";
import { mockActivationFlow } from "./helpers/activation-fixtures";
import { buildObservabilitySummary } from "./helpers/sandbox-fixtures";
import { fulfillJson } from "./helpers/automation-control-plane-fixtures";
import { textContrast } from "./helpers/text-contrast";

const run: ObservabilityJobDetail = {
  id: "00000000-0000-4000-8000-000000000077",
  assignment_id: null,
  trigger_id: null,
  status: "success",
  created_at: "2026-09-05T10:00:00Z",
  started_at: "2026-09-05T10:00:00Z",
  completed_at: "2026-09-05T10:01:10Z",
  input_tokens: 100,
  output_tokens: 20,
  duration_ms: 70000,
  cost_usd: 0.352,
  error: null,
  start_attempts: 1,
  metadata: {
    pr_number: 1477,
    pr_title: "Fix mobile canvas header overlap",
    head_ref: "fix/mobile",
  },
  source_kind: "flow",
  source_type: "pr_opened",
  repo: { id: "repo-1", full_name: "acme/widgets" },
  agent: { id: "agent-1", name: "PR Review Agent", slug: "review" },
  latest_ai_call: null,
  latest_dispatch_event: {
    id: "event-1",
    event_kind: "control",
    outcome: "completed",
    reason: "PR_REVIEW_NO_FINDINGS",
    metadata: null,
    created_at: "2026-09-05T10:01:10Z",
  },
  repairable: false,
  requeueable: false,
  cancelable: false,
  dispatch_events: [],
  ai_calls: [],
  review_findings: [],
};

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 834, height: 1112 },
  { width: 390, height: 844 },
]) {
  for (const theme of ["dark", "light"]) {
    test(`outcome-first inspector ${viewport.width} ${theme}`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize(viewport);
      await enableScopedE2EAuth(page);
      await mockActivationFlow(page);
      await page.route("**/api/observability/stats*", (route) =>
        fulfillJson(route, buildObservabilitySummary([]))
      );
      await page.route("**/api/flows/approvals", (route) =>
        fulfillJson(route, { approvals: [] })
      );
      await page.route("**/api/observability/jobs?*", (route) =>
        fulfillJson(route, { jobs: [run], total: 1, page: 1, limit: 25 })
      );
      await page.route(`**/api/observability/jobs/${run.id}?*`, (route) =>
        fulfillJson(route, { run })
      );
      await page.goto(scopedPath("observability?run_source=flow"));
      // Exercise both themes against the same real component tree.
      await page.evaluate(
        (value) =>
          document.documentElement.classList.toggle("dark", value === "dark"),
        theme
      );
      await page
        .getByRole("button", { name: "Inspect Review PR #1477", exact: true })
        .click();
      const inspector = page.getByRole("region", { name: "Run details" });
      await expect(
        inspector.getByRole("heading", { name: "Review PR #1477" })
      ).toBeVisible();
      await expect(
        inspector.getByText(
          "The review completed with no findings. This does not mean the PR has been merged."
        )
      ).toBeVisible();
      await expect(
        inspector.getByRole("link", { name: "Open PR", exact: true })
      ).toHaveAttribute("href", "https://github.com/acme/widgets/pull/1477");
      await expect(
        inspector.getByText("Cancellation requested", { exact: true })
      ).toHaveCount(0);
      await expect(
        inspector.getByText("Sanitized metadata", { exact: true })
      ).toHaveCount(0);
      await expect(page).toHaveURL(/run_id=/);
      await page.reload();
      await page.evaluate(
        (value) =>
          document.documentElement.classList.toggle("dark", value === "dark"),
        theme
      );
      await expect(
        inspector.getByRole("heading", { name: "Review PR #1477" })
      ).toBeVisible();
      await expect(page).toHaveURL(/run_source=flow/);
      await inspector.scrollIntoViewIfNeeded();
      expect(
        await textContrast(
          inspector.locator("span").filter({ hasText: /^Completed$/ })
        )
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        await textContrast(
          inspector.getByRole("link", { name: "Open PR", exact: true })
        )
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        await textContrast(
          inspector.getByText("Fix mobile canvas header overlap", {
            exact: true,
          })
        )
      ).toBeGreaterThanOrEqual(4.5);
      await page.screenshot({
        path: testInfo.outputPath("inspector.png"),
        fullPage: true,
      });
      expect(
        await page
          .locator(".observability-work")
          .evaluate((element) => element.scrollWidth <= element.clientWidth)
      ).toBe(true);
      await inspector
        .getByRole("tab", { name: "Diagnostics", exact: true })
        .click();
      await expect(
        inspector.getByText("Cancellation requested", { exact: true })
      ).toHaveCount(0);
      const metadata = inspector.locator("details");
      await expect(metadata).not.toHaveAttribute("open", "");
      await metadata.locator("summary").click();
      await expect(metadata).toHaveAttribute("open", "");
      await inspector.getByRole("button", { name: "Back to runs" }).click();
      await expect(
        page.getByRole("button", {
          name: "Inspect Review PR #1477",
          exact: true,
        })
      ).toBeVisible();
      await page
        .getByRole("tab", { name: "Needs attention", exact: true })
        .click();
      await expect(
        page.getByText(
          "No workflow approval requests are waiting for your decision."
        )
      ).toBeVisible();
      await page.getByRole("tab", { name: /Automation events/ }).click();
      await expect(
        page.getByText(/Counts are events, not failed runs/)
      ).toBeVisible();
      await page.getByRole("tab", { name: /^Usage/ }).click();
      await expect(
        page.getByRole("heading", { name: "Usage and cost" })
      ).toBeVisible();
      await expect(page).toHaveURL(/view=usage/);
    });
  }
}

test("failed run confirms new-attempt consequences and never invents recovery", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  await mockActivationFlow(page);
  const failed = {
    ...run,
    status: "failed" as const,
    error: "Timed out",
    requeueable: true,
    latest_dispatch_event: null,
  };
  let attempts = 0;
  await page.route("**/api/observability/stats*", (route) =>
    fulfillJson(route, buildObservabilitySummary([]))
  );
  await page.route(`**/api/observability/jobs/${run.id}?*`, (route) =>
    fulfillJson(route, { run: failed })
  );
  await page.route(`**/api/observability/jobs/${run.id}/requeue`, (route) => {
    attempts++;
    return fulfillJson(route, { ok: true });
  });
  await page.goto(scopedPath(`observability?view=runs&run_id=${run.id}`));
  const inspector = page.getByRole("region", { name: "Run details" });
  await expect(inspector.getByText("Timed out", { exact: true })).toBeVisible();
  await expect(
    inspector.getByRole("button", { name: "Resume saved work" })
  ).toHaveCount(0);
  await inspector
    .getByRole("button", { name: "Retry as new run", exact: true })
    .click();
  expect(attempts).toBe(0);
  await expect(
    inspector.getByText(/may repeat work and incur additional cost/)
  ).toBeVisible();
  await inspector
    .getByRole("button", { name: "Confirm retry as new run" })
    .click();
  await expect(
    inspector.getByRole("group", { name: "Retry as new run" })
  ).toHaveCount(0);
  expect(attempts).toBe(1);
});

test("inaccessible run has a recoverable error without unrelated details", async ({
  page,
}) => {
  await enableScopedE2EAuth(page);
  await mockActivationFlow(page);
  await page.route("**/api/observability/stats*", (route) =>
    fulfillJson(route, buildObservabilitySummary([]))
  );
  await page.route(`**/api/observability/jobs/${run.id}?*`, (route) =>
    fulfillJson(route, { error: "Not found" }, 404)
  );
  await page.goto(scopedPath(`observability?view=runs&run_id=${run.id}`));
  await expect(
    page.getByRole("alert").filter({ hasText: "This run is unavailable" })
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Run details" })
      .getByRole("link", { name: "Open PR" })
  ).toHaveCount(0);
});
