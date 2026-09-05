import { expect, test } from "@playwright/test";
import { scopedPath } from "./helpers/auth";
import { emptyAutomationFailuresResponse } from "./helpers/activation-fixtures";
import {
  buildObservabilitySummary,
  buildSandboxBackedCall,
} from "./helpers/sandbox-fixtures";
import {
  createBillingState,
  installBaseMocks,
  fulfillJson,
} from "./helpers/sandbox-billing-fixtures";
import type { Page } from "@playwright/test";

async function installObservabilityMocks(page: Page) {
  const call = buildSandboxBackedCall({
    repoId: "repo-1",
    sandboxRecordId: "sandbox-record-1",
    sandboxId: "sandbox-runtime-1",
    previewUrl: "https://preview.mogplex.test",
    computeBillingSource: "user_vercel_project",
    billingProjectId: "proj_user_123",
    billingTeamId: "team-acme",
    aiBillingSource: "user_ai_gateway",
  });

  await page.route("**/api/observability/stats*", (route) =>
    fulfillJson(route, buildObservabilitySummary([call]))
  );
  await page.route(/\/api\/observability\/jobs(?:\?.*)?$/, (route) =>
    fulfillJson(route, { jobs: [], total: 0, page: 1, limit: 25 })
  );
  await page.route(
    /\/api\/observability\/automation-events(?:\?.*)?$/,
    (route) => fulfillJson(route, { events: [], total: 0, page: 1, limit: 25 })
  );
  await page.route(
    /\/api\/observability\/automation-failures(?:\?.*)?$/,
    (route) => fulfillJson(route, emptyAutomationFailuresResponse)
  );
  await page.route(/\/api\/observability\/calls(?:\?.*)?$/, (route) => {
    const url = new URL(route.request().url());
    const liveOnly = url.searchParams.get("live_only") === "true";
    return fulfillJson(route, {
      calls: [call],
      total: 1,
      page: 1,
      limit: liveOnly ? 100 : 50,
    });
  });
  await page.route(/\/api\/observability\/call-events(?:\?.*)?$/, (route) =>
    fulfillJson(route, { events: [] })
  );
}

test("observability surfaces sandbox compute and AI billing details", async ({
  page,
}) => {
  const state = createBillingState({
    workspace: {
      sandbox_billing_mode: "user_vercel_project",
      sandbox_vercel_team_id: "team-acme",
      sandbox_vercel_project_id: "workspace-app",
    },
  });
  await installBaseMocks(page, state);
  await page.route("**/api/realtime/events?*", (route) =>
    route.fulfill({ status: 204 })
  );
  await installObservabilityMocks(page);

  await page.goto(scopedPath("observability"));
  await page.waitForLoadState("networkidle");

  await expect(
    page.getByRole("heading", { name: "Observability" })
  ).toBeVisible();
  await page.getByRole("tab", { name: /^Usage/ }).click();

  const activitySection = page.getByRole("tabpanel");
  await activitySection.locator("tbody tr").first().click();

  await expect(activitySection.getByText("Sandbox Billing")).toBeVisible();
  await expect(activitySection.getByText("Compute Billing")).toBeVisible();
  await expect(activitySection.getByText("user billing")).toBeVisible();
  await expect(activitySection.getByText("AI Billing Source")).toBeVisible();
  await expect(activitySection.getByText("user ai gateway")).toBeVisible();
  await expect(activitySection.getByText("proj_user_123")).toBeVisible();
  await expect(activitySection.getByText("team-acme")).toBeVisible();
  await expect(
    activitySection.getByText("sandbox-record-1", { exact: true })
  ).toBeVisible();
  await expect(
    activitySection.getByText("sandbox-runtime-1", { exact: true })
  ).toBeVisible();
});
